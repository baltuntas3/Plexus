import type { PromptVersionSummary } from "../../queries/prompt-query-service.js";

// Single source of truth for the prompt content used during benchmarking.
// Fairness rule: each version is evaluated using only its own stored prompt
// content. Benchmarking must not prepend extra framework-specific
// instructions, otherwise one prompt family receives hidden assistance that
// the others do not.
//
// Takes a read projection rather than the write-side entity — benchmarking
// only reads prompt text, never mutates, so a mutable aggregate here would
// be an anti-pattern. `executablePrompt` is pre-resolved on the projection.
export const buildEvaluationPrompt = (version: PromptVersionSummary): string => {
  return version.executablePrompt;
};
