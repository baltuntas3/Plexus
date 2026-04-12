import type { BraidGraph } from "../../../../../domain/value-objects/braid-graph.js";
import type {
  LintIssue,
  RuleResult,
} from "../../../../../domain/value-objects/graph-quality-score.js";
import type { IGraphLintRule } from "../graph-lint-rule.js";

// Paper A.4 §4: effective BRAID graphs explicitly encode a "Critic" phase —
// terminal nodes whose labels begin with Check/Verify/Validate/Assert/Critic.
const VERIFICATION_PREFIX = /^\s*(check|verify|validate|assert|critic)\b/i;

export class TerminalVerificationRule implements IGraphLintRule {
  readonly id = "terminal-verification";
  readonly displayName = "Terminal Verification Loops";

  check(graph: BraidGraph): RuleResult {
    if (graph.nodes.length === 0) {
      return { ruleId: this.id, displayName: this.displayName, score: 0, issues: [] };
    }

    const outgoing = new Set<string>();
    for (const edge of graph.edges) {
      outgoing.add(edge.from);
    }

    const terminals = graph.nodes.filter((node) => !outgoing.has(node.id));

    if (terminals.length === 0) {
      return {
        ruleId: this.id,
        displayName: this.displayName,
        score: 0,
        issues: [
          {
            ruleId: this.id,
            severity: "warning",
            message: "Graph has no terminal nodes. Add explicit verification endpoints.",
          },
        ],
      };
    }

    const issues: LintIssue[] = [];
    let verified = 0;
    for (const node of terminals) {
      if (VERIFICATION_PREFIX.test(node.label)) {
        verified += 1;
      } else {
        issues.push({
          ruleId: this.id,
          severity: "warning",
          message: `Terminal node "${node.id}" is not a verification node. Prefix with "Check:" or "Verify:".`,
          nodeId: node.id,
        });
      }
    }

    const score = (verified / terminals.length) * 100;
    return { ruleId: this.id, displayName: this.displayName, score, issues };
  }
}
