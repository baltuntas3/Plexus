import type { BraidGraph } from "../../../../../domain/value-objects/braid-graph.js";
import type {
  LintIssue,
  RuleResult,
} from "../../../../../domain/value-objects/graph-quality-score.js";
import type { IGraphLintRule } from "../graph-lint-rule.js";

// Paper A.4 §1: "nodes containing fewer than 15 tokens had the highest adherence rates".
// Token estimation uses the widely used ~4 chars/token heuristic.
const MAX_TOKENS_PER_NODE = 15;
const CHARS_PER_TOKEN = 4;

const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

export class NodeAtomicityRule implements IGraphLintRule {
  readonly id = "node-atomicity";
  readonly displayName = "Node Atomicity";

  check(graph: BraidGraph): RuleResult {
    if (graph.nodes.length === 0) {
      return { ruleId: this.id, displayName: this.displayName, score: 0, issues: [] };
    }

    const issues: LintIssue[] = [];
    let goodNodes = 0;
    for (const node of graph.nodes) {
      const tokens = estimateTokens(node.label);
      if (tokens > MAX_TOKENS_PER_NODE) {
        issues.push({
          ruleId: this.id,
          severity: "warning",
          message: `Node "${node.id}" has ~${tokens} tokens (>${MAX_TOKENS_PER_NODE}). Split into atomic steps.`,
          nodeId: node.id,
        });
      } else {
        goodNodes += 1;
      }
    }

    const score = (goodNodes / graph.nodes.length) * 100;
    return { ruleId: this.id, displayName: this.displayName, score, issues };
  }
}
