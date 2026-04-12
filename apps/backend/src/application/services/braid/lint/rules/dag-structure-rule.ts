import type { BraidGraph } from "../../../../../domain/value-objects/braid-graph.js";
import type {
  LintIssue,
  RuleResult,
} from "../../../../../domain/value-objects/graph-quality-score.js";
import type { IGraphLintRule } from "../graph-lint-rule.js";

// Paper §A.4 — BRAID graphs should be DAGs, except for explicit critic loops
// (a verification node that routes back to a revision node). Any cycle NOT
// containing a verification-prefixed node is a structural error.
const VERIFICATION_PREFIX = /^\s*(check|verify|validate|assert|critic)\b/i;
const INVALID_CYCLE_PENALTY = 30;

export class DAGStructureRule implements IGraphLintRule {
  readonly id = "dag-structure";
  readonly displayName = "DAG Structure";

  check(graph: BraidGraph): RuleResult {
    if (graph.nodes.length === 0) {
      return { ruleId: this.id, displayName: this.displayName, score: 0, issues: [] };
    }

    const adjacency = buildAdjacency(graph);
    const cycles = findCycles(adjacency);

    if (cycles.length === 0) {
      return { ruleId: this.id, displayName: this.displayName, score: 100, issues: [] };
    }

    const labels = new Map(graph.nodes.map((n) => [n.id, n.label]));
    const issues: LintIssue[] = [];
    let invalidCount = 0;

    for (const cycle of cycles) {
      const isVerificationLoop = cycle.some((id) => {
        const label = labels.get(id) ?? "";
        return VERIFICATION_PREFIX.test(label);
      });
      if (!isVerificationLoop) {
        invalidCount += 1;
        issues.push({
          ruleId: this.id,
          severity: "error",
          message: `Cycle ${cycle.join(" → ")} is not a verification loop. Break the cycle or turn one node into a Check/Verify node.`,
        });
      }
    }

    const score = Math.max(0, 100 - invalidCount * INVALID_CYCLE_PENALTY);
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

type Color = "white" | "gray" | "black";

const findCycles = (adjacency: Map<string, string[]>): string[][] => {
  const color = new Map<string, Color>();
  const parent = new Map<string, string>();
  const cycles: string[][] = [];

  for (const id of adjacency.keys()) {
    color.set(id, "white");
  }

  const dfs = (u: string): void => {
    color.set(u, "gray");
    for (const v of adjacency.get(u) ?? []) {
      const vColor = color.get(v);
      if (vColor === "white") {
        parent.set(v, u);
        dfs(v);
      } else if (vColor === "gray") {
        cycles.push(reconstructCycle(v, u, parent));
      }
    }
    color.set(u, "black");
  };

  for (const id of adjacency.keys()) {
    if (color.get(id) === "white") {
      dfs(id);
    }
  }

  return cycles;
};

const reconstructCycle = (
  start: string,
  end: string,
  parent: Map<string, string>,
): string[] => {
  const path: string[] = [end];
  let current: string | undefined = end;
  while (current !== undefined && current !== start) {
    const next = parent.get(current);
    if (!next) break;
    path.unshift(next);
    current = next;
    if (path.length > 1000) break; // guard against pathological inputs
  }
  path.push(start);
  return path;
};
