import type {
  BraidEdge,
  BraidGraph,
} from "../../../../../domain/value-objects/braid-graph.js";
import type {
  LintIssue,
  RuleResult,
} from "../../../../../domain/value-objects/graph-quality-score.js";
import type { IGraphLintRule } from "../graph-lint-rule.js";

// Paper §A.4 — "conditions should be mutually exclusive to avoid ambiguity".
// Full semantic mutual exclusivity would require an LLM; here we detect the
// structural tell-tale: two outgoing branches from the same source carrying
// the same (normalized) label.
export class MutualExclusivityRule implements IGraphLintRule {
  readonly id = "mutual-exclusivity";
  readonly displayName = "Mutually Exclusive Branches";

  check(graph: BraidGraph): RuleResult {
    const outgoing = groupEdgesBySource(graph.edges);
    const branchingSources = [...outgoing.entries()].filter(([, edges]) => edges.length >= 2);

    if (branchingSources.length === 0) {
      return { ruleId: this.id, displayName: this.displayName, score: 100, issues: [] };
    }

    const issues: LintIssue[] = [];
    let cleanSources = 0;

    for (const [source, edges] of branchingSources) {
      const labels = edges
        .map((e) => normalize(e.label))
        .filter((l) => l.length > 0);
      if (labels.length < 2) {
        cleanSources += 1;
        continue;
      }
      const unique = new Set(labels);
      if (unique.size === labels.length) {
        cleanSources += 1;
        continue;
      }
      for (const duplicate of collectDuplicates(labels)) {
        issues.push({
          ruleId: this.id,
          severity: "warning",
          message: `Source "${source}" has duplicate branch label "${duplicate}". Conditions should be mutually exclusive.`,
        });
      }
    }

    const score = (cleanSources / branchingSources.length) * 100;
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

const normalize = (label: string | null): string =>
  (label ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const collectDuplicates = (labels: string[]): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const label of labels) {
    if (seen.has(label)) {
      duplicates.add(label);
    } else {
      seen.add(label);
    }
  }
  return [...duplicates];
};
