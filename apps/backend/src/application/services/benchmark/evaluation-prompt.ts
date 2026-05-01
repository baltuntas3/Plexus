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
  if (version.variables.length > 0) {
    const lines = version.variables.map((v) => {
      const parts: string[] = [`{{${v.name}}}${v.required ? "" : " (optional)"}`];
      const desc = v.description?.trim();
      if (desc) parts.push(`— ${desc}`);
      const def = v.defaultValue?.trim();
      if (def) parts.push(`(default: ${def})`);
      return `- ${parts.join(" ")}`;
    });
    blocks.push(
      `Template variables (literal placeholders the runtime substitutes; never invent new ones):\n${lines.join("\n")}`,
    );
  }
  return blocks.join("\n\n");
};
