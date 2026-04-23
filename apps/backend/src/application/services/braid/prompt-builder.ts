import type { TaskType } from "@plexus/shared-types";
import type { ChatMessage } from "../ai-provider.js";
import { A1_SYSTEM_PROMPT, buildA1UserMessage } from "./a1-generation-prompt.js";
import {
  ENHANCED_SYSTEM_PROMPT,
  buildEnhancedUserMessage,
} from "./enhanced-generation-prompt.js";

export interface GenerationPromptInput {
  sourcePrompt: string;
  conversationText: string;
}

export type GenerationPromptBuilder = (input: GenerationPromptInput) => ChatMessage[];

// Production default: paper A.1 augmented with all seven BRAID quality
// principles enforced by the linter.
export const enhancedBuilder: GenerationPromptBuilder = (input) => [
  { role: "system", content: ENHANCED_SYSTEM_PROMPT },
  { role: "user", content: buildEnhancedUserMessage(input.conversationText) },
];

// Baseline: paper Appendix A.1 verbatim. Kept for research parity and for a
// future meta-benchmark comparing baseline vs enhanced generation.
export const a1Builder: GenerationPromptBuilder = (input) => [
  { role: "system", content: A1_SYSTEM_PROMPT },
  { role: "user", content: buildA1UserMessage(input.conversationText) },
];

const buildersByTaskType: Partial<Record<TaskType, GenerationPromptBuilder>> = {};

export const getGenerationPromptBuilder = (taskType: TaskType): GenerationPromptBuilder =>
  buildersByTaskType[taskType] ?? enhancedBuilder;
