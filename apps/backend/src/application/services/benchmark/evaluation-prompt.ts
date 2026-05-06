import type { PromptVersionSummary } from "../../queries/prompt-query-service.js";
import { formatTemplateVariableList } from "../template-variables-prompt.js";

// Single source of truth for the prompt content used during benchmarking.
//
// Fairness rule: each version is evaluated using only its own stored prompt
// content. Benchmarking must not prepend extra framework-specific
// instructions, otherwise one prompt family receives hidden assistance that
// the others do not. The one exception is the BRAID runtime wrapper below
// — it is applied UNIFORMLY to every BRAID version (so no BRAID version
// gets help over another BRAID version) and it ONLY restores parity with
// classical prompts, which already carry their own implicit output spec
// inside their text. Without the wrapper, a classical prompt that says
// "respond in JSON" gets a terse JSON answer while an equivalent BRAID
// graph with the same intended output gets a multi-paragraph narration
// (the model sees mermaid as "explain this graph" rather than "execute
// this workflow silently"), which biases the comparison against BRAID.
//
// Takes a read projection rather than the write-side entity — benchmarking
// only reads prompt text, never mutates, so a mutable aggregate here would
// be an anti-pattern. `executablePrompt` is pre-resolved on the projection.

// Matches the Mermaid header that BRAID graphs are validated against
// (see BraidGraph.HEADER_PATTERN). Anchored to start-of-string so a
// classical prompt that happens to mention "flowchart" mid-text is not
// misclassified as a BRAID graph.
const MERMAID_PREFIX_PATTERN = /^\s*(flowchart|graph)\s+TD\b/i;

const BRAID_RUNTIME_INSTRUCTION = [
  "You are an automated agent whose response is consumed by another program. Internally follow the workflow graph below to decide your answer, then OUTPUT ONLY THE FINAL RESULT in the format implied by the graph's terminal node — no narration, no step-by-step reasoning, no markdown headers, no tables, no preamble.",
  "",
  "Workflow graph:",
].join("\n");

export const buildEvaluationPrompt = (version: PromptVersionSummary): string => {
  const raw = version.executablePrompt;
  if (!MERMAID_PREFIX_PATTERN.test(raw)) return raw;
  return `${BRAID_RUNTIME_INSTRUCTION}\n${raw}`;
};

// Spec block fed to the test-case generator. The generator never executes the
// prompt, so the fairness rule above does not apply here — the goal is the
// opposite: give the generator enough context to understand what this system
// actually does, so it can produce realistic, domain-aware inputs instead of
// generic LLM probes.
//
// For BRAID versions the executable form is mermaid; surfacing only that to
// the generator pushes it toward shallow / nonsensical cases because the
// graph is hard to read as natural language. We pair the original source
// prompt with the graph (when present) and list the version's template
// variables with their descriptions so the generator treats `{{name}}`
// references as literal placeholders rather than inventing new ones.
export const buildVersionGenerationSection = (
  version: PromptVersionSummary,
): string => {
  const blocks: string[] = [];
  blocks.push(`Prompt source:\n${version.sourcePrompt}`);
  if (version.braidGraph) {
    blocks.push(
      `BRAID workflow graph (the prompt decomposed into atomic decision steps; the system follows this graph at runtime):\n${version.braidGraph}`,
    );
  }
  // Variable LIST only — the placeholder-handling RULE itself is emitted
  // once at the prompt level by buildGenerationPrompt (PHASE 1 #6),
  // so duplicating it per-version here would re-state the same rule
  // twice in a single LLM call.
  const variableList = formatTemplateVariableList(version.variables);
  if (variableList) {
    blocks.push(`Declared template variables:\n${variableList}`);
  }
  return blocks.join("\n\n");
};
