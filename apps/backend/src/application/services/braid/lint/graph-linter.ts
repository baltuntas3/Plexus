import type { BraidGraph } from "../../../../domain/value-objects/braid-graph.js";
import { GraphQualityScore } from "../../../../domain/value-objects/graph-quality-score.js";
import type { IGraphLintRule } from "./graph-lint-rule.js";

export class GraphLinter {
  constructor(private readonly rules: IGraphLintRule[]) {}

  lint(graph: BraidGraph): GraphQualityScore {
    const results = this.rules.map((rule) => rule.check(graph));
    return GraphQualityScore.fromRuleResults(results);
  }
}
