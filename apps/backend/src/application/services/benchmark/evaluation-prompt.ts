import type { PromptVersion } from "../../../domain/entities/prompt-version.js";

// Single source of truth for the prompt content used during benchmarking.
// Fairness rule: each version is evaluated using only its own stored prompt
// content. Benchmarking must not prepend extra framework-specific
// instructions, otherwise one prompt family receives hidden assistance that
// the others do not.
export const buildEvaluationPrompt = (version: PromptVersion): string => {
  if (version.braidGraph) {
    return version.braidGraph;
  }
  return version.classicalPrompt;
};
