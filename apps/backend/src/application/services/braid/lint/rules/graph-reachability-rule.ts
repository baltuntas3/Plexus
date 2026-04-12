import type { BraidGraph } from "../../../../../domain/value-objects/braid-graph.js";
import type {
  LintIssue,
  RuleResult,
} from "../../../../../domain/value-objects/graph-quality-score.js";
import type { IGraphLintRule } from "../graph-lint-rule.js";

// Every node in a BRAID graph must participate in the single reasoning flow.
// Roots are nodes with no incoming edges; from those we BFS the rest of the
// graph. Any node not reached is an orphan and reduces the score.
export class GraphReachabilityRule implements IGraphLintRule {
  readonly id = "graph-reachability";
  readonly displayName = "Reachability";

  check(graph: BraidGraph): RuleResult {
    if (graph.nodes.length === 0) {
      return { ruleId: this.id, displayName: this.displayName, score: 0, issues: [] };
    }

    const incoming = new Set<string>();
    for (const edge of graph.edges) {
      incoming.add(edge.to);
    }

    const roots = graph.nodes.filter((n) => !incoming.has(n.id));
    // If every node has an incoming edge, the graph is fully cyclic — leave
    // that for DAGStructureRule to flag and treat this check as neutral.
    if (roots.length === 0) {
      return { ruleId: this.id, displayName: this.displayName, score: 100, issues: [] };
    }

    const adjacency = buildAdjacency(graph);
    const reached = new Set<string>();
    const queue: string[] = [];
    for (const root of roots) {
      reached.add(root.id);
      queue.push(root.id);
    }

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      for (const next of adjacency.get(current) ?? []) {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }

    const orphans = graph.nodes.filter((n) => !reached.has(n.id));
    const issues: LintIssue[] = orphans.map((n) => ({
      ruleId: this.id,
      severity: "warning",
      message: `Node "${n.id}" is not reachable from any root node.`,
      nodeId: n.id,
    }));

    const score = (reached.size / graph.nodes.length) * 100;
    return { ruleId: this.id, displayName: this.displayName, score, issues };
  }
}

const buildAdjacency = (graph: BraidGraph): Map<string, string[]> => {
  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adj.set(node.id, []);
  }
  for (const edge of graph.edges) {
    const bucket = adj.get(edge.from) ?? [];
    bucket.push(edge.to);
    adj.set(edge.from, bucket);
  }
  return adj;
};
