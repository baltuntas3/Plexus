// BraidChatAgent handles two modes, both with a single LLM call so the
// chat interface stays responsive:
//
//  Generation (no currentMermaid): ENHANCED_SYSTEM_PROMPT + classical
//    prompt + user message. The user's instruction becomes the "conversation"
//    context the system prompt reasons over.
//
//  Refinement (currentMermaid provided): ENHANCED_SYSTEM_PROMPT + existing
//    draft + user instruction. The model applies the targeted change while
//    keeping all 7 BRAID rules in context.

import type { IAIProvider } from "../ai-provider.js";
import type { TaskType } from "@plexus/shared-types";
import { ENHANCED_SYSTEM_PROMPT } from "./enhanced-generation-prompt.js";

export interface ChatInput {
  classicalPrompt: string;
  taskType: TaskType;
  userMessage: string;
  currentMermaid?: string;
}

export interface ChatOutput {
  mermaidCode: string;
  totalInputTokens: number;
  totalOutputTokens: number;
}

const FENCE_REGEX = /```(?:mermaid)?\s*([\s\S]*?)```/;

const cleanMermaidCode = (text: string): string => {
  const fenced = FENCE_REGEX.exec(text.trim());
  return (fenced?.[1]?.trim() ?? text.trim()).replace(/^```.*$/gm, "").trim();
};

export class BraidChatAgent {
  constructor(
    private readonly provider: IAIProvider,
    private readonly model: string,
  ) {}

  async chat(input: ChatInput): Promise<ChatOutput> {
    if (input.currentMermaid) {
      return this.refine(input.currentMermaid, input.userMessage);
    }
    return this.generate(input.classicalPrompt, input.taskType, input.userMessage);
  }

  // ── Initial generation (single LLM call) ────────────────────────────────

  private async generate(
    classicalPrompt: string,
    _taskType: TaskType,
    userMessage: string,
  ): Promise<ChatOutput> {
    const conversationText = userMessage
      ? `${classicalPrompt}\n\nUser instruction: ${userMessage}`
      : classicalPrompt;

    const response = await this.provider.generate({
      model: this.model,
      temperature: 0,
      messages: [
        { role: "system", content: ENHANCED_SYSTEM_PROMPT },
        { role: "user", content: `Conversation:\n${conversationText}` },
      ],
    });

    return {
      mermaidCode: cleanMermaidCode(response.text),
      totalInputTokens: response.usage.inputTokens,
      totalOutputTokens: response.usage.outputTokens,
    };
  }

  // ── Targeted refinement ──────────────────────────────────────────────────

  private async refine(currentMermaid: string, userMessage: string): Promise<ChatOutput> {
    const response = await this.provider.generate({
      model: this.model,
      temperature: 0,
      messages: [
        { role: "system", content: ENHANCED_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            "Here is the current BRAID graph:",
            "```mermaid",
            currentMermaid,
            "```",
            "",
            `User instruction: ${userMessage}`,
            "",
            "Apply the instruction to produce an improved BRAID.",
            'Return ONLY the updated Mermaid code starting with "flowchart TD;". No prose, no fences.',
          ].join("\n"),
        },
      ],
    });

    return {
      mermaidCode: cleanMermaidCode(response.text),
      totalInputTokens: response.usage.inputTokens,
      totalOutputTokens: response.usage.outputTokens,
    };
  }
}
