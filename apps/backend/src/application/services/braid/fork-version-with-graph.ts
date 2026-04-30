import type { Prompt } from "../../../domain/entities/prompt.js";
import { PromptVersion } from "../../../domain/entities/prompt-version.js";
import { BraidAuthorship } from "../../../domain/value-objects/braid-authorship.js";
import type { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";
import { PromptVariable } from "../../../domain/value-objects/prompt-variable.js";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { GraphLinter } from "./lint/graph-linter.js";
import { assertVariableIntegrity } from "../prompts/variable-integrity.js";

export interface ForkVersionWithGraphParams {
  prompt: Prompt;
  source: PromptVersion;
  newGraph: BraidGraph;
  linter: GraphLinter;
  idGenerator: IIdGenerator;
  versions: IPromptVersionRepository;
  prompts: IPromptRepository;
  // Variables to declare on the forked version in addition to those
  // inherited from the source. Powers the visual editor's inline
  // "create variable" flow: the user types `{{newVar}}` and selects
  // the create option, modal sends `addVariables: [{ name: "newVar" }]`
  // and the new fork carries the merged list. Names that already
  // exist on the source are silently ignored (idempotent — caller
  // doesn't have to dedupe client-side).
  additionalVariables?: ReadonlyArray<PromptVariable>;
}

export interface ForkVersionWithGraphResult {
  newVersion: string;
  qualityScore: GraphQualityScore;
}

// Shared tail for every "edit a BRAID graph and produce a new version"
// flow — manual mermaid replace, structural primitives (rename node,
// add edge, …), and any future graph-level edit. The caller owns the
// surrounding UoW boundary so save+save+linter all happen inside one
// atomic step from the client's point of view.
//
// Authorship: every manual graph edit records `BraidAuthorship.manual`
// with `derivedFromModel` pointing to the source's display model so
// audits can trace the lineage back to the LLM that originally seeded
// the graph (or null when the source itself was already manual with
// no further ancestor).
export const forkVersionWithGraph = async (
  params: ForkVersionWithGraphParams,
): Promise<ForkVersionWithGraphResult> => {
  // Merge inherited + new variables, deduped by name. Caller passing
  // a name that already exists on the source is silently ignored so
  // frontend doesn't have to track which names are new vs existing.
  const mergedVariables: PromptVariable[] = [...params.source.variables];
  if (params.additionalVariables && params.additionalVariables.length > 0) {
    const existing = new Set(mergedVariables.map((v) => v.name));
    for (const v of params.additionalVariables) {
      if (existing.has(v.name)) continue;
      mergedVariables.push(v);
      existing.add(v.name);
    }
  }

  // Defense-in-depth: catches the case where a structural mutation
  // introduced an undeclared `{{var}}` reference in a node label.
  // The integrity check runs against the merged set so newly-declared
  // variables cover newly-added references.
  assertVariableIntegrity({
    body: params.source.sourcePrompt,
    mermaid: params.newGraph.mermaidCode,
    variables: mergedVariables,
  });

  const qualityScore = params.linter.lint(params.newGraph);
  const label = params.prompt.allocateNextVersionLabel();
  const forked = PromptVersion.fork({
    source: params.source,
    newId: params.idGenerator.newId(),
    newLabel: label,
    initialBraid: {
      graph: params.newGraph,
      authorship: BraidAuthorship.manual(params.source.generatorModel),
    },
    variables: mergedVariables,
  });
  await params.versions.save(forked);
  await params.prompts.save(params.prompt);
  return { newVersion: forked.version, qualityScore };
};
