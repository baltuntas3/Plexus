import type {
  GraphQualityScoreDto,
  PromptDto,
  PromptVersionDto,
  RuleResultDto,
} from "@plexus/shared-types";
import type {
  PromptSummary,
  PromptVersionSummary,
} from "../../../application/queries/prompt-query-service.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";


// Presentation-layer mappers. Domain entities never reach this file — write
// use cases hand back summaries via `versionToSummary` / `promptToSummary`,
// and read use cases hand back summaries directly from the query service.
// Keeps the CQRS split honest and the presentation layer free of
// `instanceof` branches on domain classes.

export const toPromptDto = (prompt: PromptSummary): PromptDto => ({
  id: prompt.id,
  name: prompt.name,
  description: prompt.description,
  taskType: prompt.taskType,
  organizationId: prompt.organizationId,
  creatorId: prompt.creatorId,
  productionVersion: prompt.productionVersion,
  createdAt: prompt.createdAt.toISOString(),
  updatedAt: prompt.updatedAt.toISOString(),
});

export const toPromptVersionDto = (
  version: PromptVersionSummary,
): PromptVersionDto => ({
  id: version.id,
  promptId: version.promptId,
  version: version.version,
  name: version.name,
  parentVersionId: version.parentVersionId,
  sourcePrompt: version.sourcePrompt,
  braidGraph: version.braidGraph,
  braidGraphLayout: version.braidGraphLayout,
  braidAuthorship: version.braidAuthorship,
  generatorModel: version.generatorModel,
  variables: version.variables,
  status: version.status,
  createdAt: version.createdAt.toISOString(),
  updatedAt: version.updatedAt.toISOString(),
});

export const toGraphQualityScoreDto = (score: GraphQualityScore): GraphQualityScoreDto => ({
  overall: score.overall,
  results: score.results.map(
    (r): RuleResultDto => ({
      ruleId: r.ruleId,
      displayName: r.displayName,
      score: r.score,
      issues: r.issues.map((i) => ({
        ruleId: i.ruleId,
        severity: i.severity,
        message: i.message,
        ...(i.nodeId !== undefined ? { nodeId: i.nodeId } : {}),
        ...(i.edgeKey !== undefined ? { edgeKey: i.edgeKey } : {}),
      })),
    }),
  ),
});
