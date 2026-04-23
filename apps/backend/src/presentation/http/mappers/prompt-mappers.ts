import type {
  BraidGraphDto,
  GraphQualityScoreDto,
  PromptDto,
  PromptVersionDto,
  RuleResultDto,
} from "@plexus/shared-types";
import type { Prompt } from "../../../domain/entities/prompt.js";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import type { PromptSummary } from "../../../application/queries/prompt-query-service.js";
import type { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";

// Duck-types over both the Prompt aggregate and the PromptSummary read view so
// list controllers can render without hydrating a full aggregate.
type PromptLike = Pick<
  Prompt,
  "id" | "name" | "description" | "taskType" | "ownerId" | "productionVersion" | "createdAt" | "updatedAt"
> | PromptSummary;

export const toPromptDto = (prompt: PromptLike): PromptDto => ({
  id: prompt.id,
  name: prompt.name,
  description: prompt.description,
  taskType: prompt.taskType,
  ownerId: prompt.ownerId,
  productionVersion: prompt.productionVersion,
  createdAt: prompt.createdAt.toISOString(),
  updatedAt: prompt.updatedAt.toISOString(),
});

export const toPromptVersionDto = (version: PromptVersion): PromptVersionDto => ({
  id: version.id,
  promptId: version.promptId,
  version: version.version,
  name: version.name,
  sourcePrompt: version.sourcePrompt,
  braidGraph: version.braidGraph?.mermaidCode ?? null,
  generatorModel:
    version.representation.kind === "braid" ? version.representation.generatorModel : null,
  solverModel: version.solverModel,
  status: version.status,
  createdAt: version.createdAt.toISOString(),
  updatedAt: version.updatedAt.toISOString(),
});

export const toBraidGraphDto = (graph: BraidGraph): BraidGraphDto => ({
  mermaidCode: graph.mermaidCode,
  nodes: graph.nodes.map((n) => ({ id: n.id, label: n.label })),
  edges: graph.edges.map((e) => ({ from: e.from, to: e.to, label: e.label })),
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
