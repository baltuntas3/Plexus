import type {
  BraidEdge,
  BraidGraph,
} from "../../../../../domain/value-objects/braid-graph.js";
import type {
  LintIssue,
  RuleResult,
} from "../../../../../domain/value-objects/graph-quality-score.js";
import type { IGraphLintRule } from "../graph-lint-rule.js";

// Paper A.4 §3: branches from a decision node must carry explicit conditions
// so a small solver model does not have to "guess" which edge to take.
export class DeterministicBranchingRule implements IGraphLintRule {
  readonly id = "deterministic-branching";
  readonly displayName = "Deterministic Branching";

  check(graph: BraidGraph): RuleResult {
    const outgoing = groupEdgesBySource(graph.edges);
    const branchingSources = [...outgoing.entries()].filter(([, edges]) => edges.length >= 2);

    if (branchingSources.length === 0) {
      return {
        ruleId: this.id,
        displayName: this.displayName,
        score: 100,
        issues: [],
      };
    }

    const issues: LintIssue[] = [];
    let cleanBranches = 0;
    for (const [source, edges] of branchingSources) {
      const unlabeled = edges.filter((e) => e.label === null || e.label.trim().length === 0);
      if (unlabeled.length === 0) {
        cleanBranches += 1;
      } else {
        for (const edge of unlabeled) {
          issues.push({
            ruleId: this.id,
            severity: "warning",
            message: `Branch ${source} → ${edge.to} has no condition label. Add "-- \\"if ...\\" -->".`,
            edgeKey: `${source}->${edge.to}`,
          });
        }
      }
    }

    const score = (cleanBranches / branchingSources.length) * 100;
    return { ruleId: this.id, displayName: this.displayName, score, issues };
  }
}

const groupEdgesBySource = (edges: BraidEdge[]): Map<string, BraidEdge[]> => {
  const map = new Map<string, BraidEdge[]>();
  for (const edge of edges) {
    const bucket = map.get(edge.from) ?? [];
    bucket.push(edge);
    map.set(edge.from, bucket);
  }
  return map;
};
