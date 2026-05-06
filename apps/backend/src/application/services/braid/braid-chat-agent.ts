// BraidChatAgent handles interactive BRAID generation and refinement.
//
// Stateless multi-turn: the caller maintains the conversation history
// and passes the full prior history with every call. The agent prepends
// a system prompt (BRAID rules + source prompt + variables + current
// mermaid) and runs a single LLM call returning a discriminated
// response:
//   { type: "diagram", mermaidCode }  — a new or updated BRAID graph
//   { type: "question", question }    — a clarifying question when the
//                                       instruction is too ambiguous to act on
//
// Generation vs. refinement is determined by whether `currentMermaid`
// is set: a version with a graph is in refinement mode, otherwise the
// agent generates from scratch. The two modes use slightly different
// system prompt language but the same response format.

import type { IAIProvider } from "../ai-provider.js";
import type { BraidChatTurn, TaskType } from "@plexus/shared-types";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import { TEMPLATE_VARIABLE_PLACEHOLDER_RULE_SHORT } from "../template-variables-prompt.js";
import { buildCompactBraidRulesPrompt } from "./braid-rules-prompt.js";

type ChatOutputType = "diagram" | "question";

interface ChatOutput {
  type: ChatOutputType;
  mermaidCode: string;  // non-empty when type === "diagram"
  question: string;     // non-empty when type === "question"
  totalInputTokens: number;
  totalOutputTokens: number;
}

interface ChatInput {
  sourcePrompt: string;
  taskType: TaskType;
  userMessage: string;
  currentMermaid?: string;
  // Variable names declared on the source PromptVersion so the agent
  // can preserve `{{name}}` references in node labels rather than
  // inlining concrete values. Empty when the prompt uses no variables.
  variableNames?: string[];
  // Conversation history *prior* to the current `userMessage`. Empty
  // for the first turn. Each turn is forwarded as-is — the agent does
  // not edit, summarise, or drop past entries.
  history?: BraidChatTurn[];
}

const BRAID_RULES = buildCompactBraidRulesPrompt();

const RESPONSE_FORMAT = `Respond ONLY with a valid JSON object — one of these two shapes:

If you need clarification:
{"type": "question", "text": "Your single focused question here"}

If you can produce the graph:
{"type": "diagram", "mermaid": "flowchart TD;\\n  A[...];\\n  ..."}

No other text outside the JSON object.`;

const stripFences = (text: string): string => {
  const t = text.trim();
  return t.startsWith("```")
    ? t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim()
    : t;
};

const parseAgentResponse = (text: string): { type: "diagram"; mermaid: string } | { type: "question"; text: string } | null => {
  try {
    const parsed = JSON.parse(stripFences(text)) as {
      type?: string;
      mermaid?: string;
      text?: string;
    };
    if (parsed.type === "diagram" && typeof parsed.mermaid === "string") {
      return { type: "diagram", mermaid: parsed.mermaid.trim() };
    }
    if (parsed.type === "question" && typeof parsed.text === "string") {
      return { type: "question", text: parsed.text.trim() };
    }
    return null;
  } catch {
    return null;
  }
};

export class BraidChatAgent {
  constructor(
    private readonly provider: IAIProvider,
    private readonly model: string,
  ) {}

  async chat(input: ChatInput): Promise<ChatOutput> {
    const systemPrompt = this.buildSystemPrompt({
      sourcePrompt: input.sourcePrompt,
      taskType: input.taskType,
      currentMermaid: input.currentMermaid,
      variableNames: input.variableNames ?? [],
    });
    // Conversation messages: system + every prior turn + the new user
    // message. Past turns are passed through verbatim so the LLM sees
    // the same history the user does (no agent-side rewriting), which
    // is what stateless multi-turn requires.
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      ...(input.history ?? []).map((t) => ({
        role: t.role === "agent" ? ("assistant" as const) : ("user" as const),
        content: t.content,
      })),
      { role: "user", content: input.userMessage },
    ];
    const response = await this.provider.generate({
      model: this.model,
      temperature: 0,
      messages,
      // The agent contract is "respond with one of two JSON shapes". Asking
      // the provider to enforce JSON output (where supported) shrinks the
      // surface where parseAgentResponse has to recover from leaked
      // markdown fences or partial-prose preambles. Providers that do not
      // honour the field fall back to prompt-only enforcement, which the
      // RESPONSE_FORMAT block already drives.
      responseFormat: "json",
    });
    return this.buildOutput(response.text, response.usage.inputTokens, response.usage.outputTokens);
  }

  // ── System prompt assembly ────────────────────────────────────────────────

  private buildSystemPrompt(ctx: {
    sourcePrompt: string;
    taskType: TaskType;
    currentMermaid: string | undefined;
    variableNames: string[];
  }): string {
    const lines: string[] = [];
    lines.push(
      ctx.currentMermaid
        ? "You are an expert BRAID graph designer refining an existing graph interactively."
        : "You are an expert BRAID graph designer working interactively with a user.",
    );
    lines.push("");
    lines.push(BRAID_RULES);
    lines.push("");
    lines.push(`Task type: ${ctx.taskType}`);
    lines.push("");
    lines.push("Original task (classical prompt):");
    lines.push("---");
    lines.push(ctx.sourcePrompt);
    lines.push("---");
    if (ctx.variableNames.length > 0) {
      lines.push("");
      lines.push(TEMPLATE_VARIABLE_PLACEHOLDER_RULE_SHORT);
      lines.push(
        `Declared variables: ${ctx.variableNames.map((n) => `{{${n}}}`).join(", ")}`,
      );
    }
    if (ctx.currentMermaid) {
      lines.push("");
      lines.push("Current BRAID graph:");
      lines.push("```mermaid");
      lines.push(ctx.currentMermaid);
      lines.push("```");
      lines.push("");
      lines.push(
        "Apply the user's requested change while keeping ALL 7 rules intact. Ask a clarifying question only when the instruction is ambiguous or rule-violating with no clean fix.",
      );
    } else {
      lines.push("");
      lines.push(
        "Generate a BRAID graph for this task. Ask a clarifying question ONLY if the description is so vague that you cannot determine the core reasoning steps or decision points.",
      );
    }
    lines.push("");
    lines.push(RESPONSE_FORMAT);
    return lines.join("\n");
  }

  // ── Response parsing ─────────────────────────────────────────────────────

  private buildOutput(rawText: string, inputTokens: number, outputTokens: number): ChatOutput {
    const parsed = parseAgentResponse(rawText);

    // Surface a parse failure as a domain error rather than wrapping the
    // raw text into a fake "question". A non-conforming output is an agent
    // bug, not a user-facing question; classifying it as one would silently
    // pollute the conversation with whatever the model actually emitted
    // (markdown explanations, partial JSON, leaked thinking) and the
    // frontend would render that as if the agent asked for clarification.
    // The use case translates this to an HTTP 422 so the user can retry.
    if (!parsed) {
      throw ValidationError(
        "BRAID chat agent returned a response that did not match the required JSON shape. The model output could not be classified as a diagram or a question.",
        { rawText },
      );
    }

    if (parsed.type === "question") {
      return {
        type: "question",
        mermaidCode: "",
        question: parsed.text,
        totalInputTokens: inputTokens,
        totalOutputTokens: outputTokens,
      };
    }

    return {
      type: "diagram",
      mermaidCode: parsed.mermaid,
      question: "",
      totalInputTokens: inputTokens,
      totalOutputTokens: outputTokens,
    };
  }
}
