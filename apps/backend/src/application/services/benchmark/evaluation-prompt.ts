import type { PromptVersionSummary } from "../../queries/prompt-query-service.js";
import { formatTemplateVariableList } from "../template-variables-prompt.js";

// Single source of truth for the prompt content used during benchmarking.
//
// Fairness rule: each version is evaluated using only its own stored prompt
// content. Benchmarking must not prepend extra framework-specific
// instructions, otherwise one prompt family receives hidden assistance that
// the others do not. The one exception is the BRAID runtime wrapper below.
//
// Why the BRAID wrapper exists: a default LLM, given a mermaid graph as a
// system prompt, treats it as "explain this diagram" rather than "execute
// this workflow silently and emit only the terminal output". So a BRAID
// version that decomposes a "respond in JSON" task into a graph would, by
// default, narrate the graph traversal back to the user — and the judge's
// instruction axis would penalise it for ignoring the implicit output
// contract that exists everywhere outside the mermaid representation.
// The wrapper restores the "act on the workflow, then output the final
// result" semantics that classical prompts get for free.
//
// Asymmetry — fully acknowledged: the wrapper is applied to BRAID versions
// only. Two situations where this is not perfectly fair:
//   1. A classical prompt that does NOT specify an output discipline still
//      lets the solver narrate freely. A BRAID version of "the same task"
//      with the wrapper will produce terse output. If the judge's
//      instruction axis interprets verbosity as a failure to "follow
//      implied formatting", BRAID gets a small lift it did not earn.
//   2. The wrapper text itself is fixed, so it cannot follow the specific
//      output contract a particular BRAID graph encodes — a graph whose
//      terminal node implies "explain the reasoning step by step" will be
//      pushed by the wrapper toward terseness anyway, biasing AGAINST
//      BRAID for that subclass of tasks.
// Both directions are mild in practice and the wrapper is uniform across
// every BRAID candidate (so no BRAID version gets help over another),
// which is the comparison the analyzer is actually built around. This
// stays a deliberate trade-off rather than a clean fairness fix.
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
