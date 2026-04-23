// BraidChatAgent handles interactive BRAID generation and refinement.
//
// Both modes use a single LLM call and return a discriminated response:
//   { type: "diagram", mermaidCode }  — a new or updated BRAID graph
//   { type: "question", question }    — a clarifying question when the
//                                       instruction is too ambiguous to act on
//
// Generation (no currentMermaid): builds a BRAID from a classical prompt + user message.
// Refinement (currentMermaid provided): applies a targeted change to an existing graph,
//   with the original classical prompt as context so the agent can reason about
//   whether a requested change is appropriate for the task.

import type { IAIProvider } from "../ai-provider.js";
import type { TaskType } from "@plexus/shared-types";

export type ChatOutputType = "diagram" | "question";

export interface ChatOutput {
  type: ChatOutputType;
  mermaidCode: string;  // non-empty when type === "diagram"
  question: string;     // non-empty when type === "question"
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface ChatInput {
  sourcePrompt: string;
  taskType: TaskType;
  userMessage: string;
  currentMermaid?: string;
}

// Condensed BRAID rules for the interactive prompt. The full rules live in
// enhanced-generation-prompt.ts; this variant is trimmed for token efficiency
// while preserving all 7 constraints that the linter will check.
const BRAID_RULES = `BRAID graph rules (MANDATORY — the linter will check all of these):
1. NODE ATOMICITY: Each node = one discrete reasoning step, ≤15 tokens. No dense multi-action nodes.
2. NO ANSWER LEAKAGE: Nodes encode the PLAN, never the literal output text.
3. DETERMINISTIC BRANCHING: Every fork uses a diamond node {Question?} with labeled edges on every branch.
4. MUTUAL EXCLUSIVITY: Branch conditions from the same node must be mutually exclusive and exhaustive.
5. TERMINAL VERIFICATION LOOPS (most important): Every terminal node must start with Check/Verify/Validate/Assert/Critic. At least one Check node must have a fail→revise→Check back-loop. Terminals like "End", "Done", "Output" are forbidden.
6. DAG STRUCTURE: The graph is a DAG except for the critic-revision loops required by rule 5.
7. REACHABILITY: Every node must be reachable from the root. No orphan nodes.

Mermaid syntax: start with "flowchart TD;" — use A[label] for actions, A{label?} for decisions, end each line with semicolon.`;

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
    if (input.currentMermaid) {
      return this.refine(input.currentMermaid, input.sourcePrompt, input.userMessage);
    }
    return this.generate(input.sourcePrompt, input.userMessage);
  }

  // ── Initial generation ───────────────────────────────────────────────────

  private async generate(sourcePrompt: string, userMessage: string): Promise<ChatOutput> {
    const taskDescription = userMessage
      ? `${sourcePrompt}\n\nUser instruction: ${userMessage}`
      : sourcePrompt;

    const systemPrompt = [
      "You are an expert BRAID graph designer working interactively with a user.",
      "",
      BRAID_RULES,
      "",
      "Your task: convert the task description below into a BRAID Mermaid flowchart.",
      "Ask a clarifying question ONLY if the description is so vague that you cannot determine the core reasoning steps or decision points. If you have enough to work with, generate the graph.",
      "",
      RESPONSE_FORMAT,
    ].join("\n");

    const response = await this.provider.generate({
      model: this.model,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Task description:\n${taskDescription}` },
      ],
    });

    return this.buildOutput(response.text, response.usage.inputTokens, response.usage.outputTokens);
  }

  // ── Targeted refinement ──────────────────────────────────────────────────

  private async refine(
    currentMermaid: string,
    sourcePrompt: string,
    userMessage: string,
  ): Promise<ChatOutput> {
    const systemPrompt = [
      "You are an expert BRAID graph designer refining an existing graph interactively.",
      "",
      BRAID_RULES,
      "",
      "You will receive:",
      "  • The original task description (classical prompt) — for context",
      "  • The current BRAID graph",
      "  • A user instruction describing the desired change",
      "",
      "Ask a clarifying question when:",
      "  • The instruction is ambiguous (e.g. 'add a branch' without specifying where or on what condition)",
      "  • The requested change would violate a BRAID rule and you need more info to find a rule-compliant alternative",
      "  • The change conflicts with the original task in a way you cannot resolve without input",
      "",
      "Otherwise apply the change, keeping ALL 7 rules intact.",
      "",
      RESPONSE_FORMAT,
    ].join("\n");

    const response = await this.provider.generate({
      model: this.model,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            "Original task (classical prompt):",
            "---",
            sourcePrompt,
            "---",
            "",
            "Current BRAID graph:",
            "```mermaid",
            currentMermaid,
            "```",
            "",
            `User instruction: ${userMessage}`,
          ].join("\n"),
        },
      ],
    });

    return this.buildOutput(response.text, response.usage.inputTokens, response.usage.outputTokens);
  }

  // ── Response parsing ─────────────────────────────────────────────────────

  private buildOutput(rawText: string, inputTokens: number, outputTokens: number): ChatOutput {
    const parsed = parseAgentResponse(rawText);

    if (!parsed) {
      // Fallback: treat the whole text as a question so we don't silently swallow it
      return {
        type: "question",
        mermaidCode: "",
        question: rawText.trim(),
        totalInputTokens: inputTokens,
        totalOutputTokens: outputTokens,
      };
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
