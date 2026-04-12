import type { BraidGraph } from "../../../../domain/value-objects/braid-graph.js";
import type { RuleResult } from "../../../../domain/value-objects/graph-quality-score.js";

export interface IGraphLintRule {
  readonly id: string;
  readonly displayName: string;
  check(graph: BraidGraph): RuleResult;
}
