import type { BraidGraph } from "../../../../../domain/value-objects/braid-graph.js";
import type {
  LintIssue,
  RuleResult,
} from "../../../../../domain/value-objects/graph-quality-score.js";
import type { IGraphLintRule } from "../graph-lint-rule.js";

// Paper A.4 §2: nodes should scaffold the answer, not contain it literally.
// Heuristic: quoted text of >= 3 words OR "Write/Draft" verbs followed by prose
// suggest the model is being told exactly what to output.
const QUOTED_TEXT = /["'](?:[^"']{3,})["']/;
const MIN_WORDS_IN_QUOTE = 3;
const LEAKY_VERB_PATTERN =
  /\b(write|draft|respond with|reply with|say|output|produce)\b\s*:\s*[A-Z]/i;

export class AnswerLeakageRule implements IGraphLintRule {
  readonly id = "answer-leakage";
  readonly displayName = "No Answer Leakage";

  check(graph: BraidGraph): RuleResult {
    if (graph.nodes.length === 0) {
      return { ruleId: this.id, displayName: this.displayName, score: 0, issues: [] };
    }

    const issues: LintIssue[] = [];
    let cleanNodes = 0;
    for (const node of graph.nodes) {
      const quotedMatch = QUOTED_TEXT.exec(node.label);
      const quoted = quotedMatch?.[0] ?? "";
      const quotedWords = quoted.split(/\s+/).filter(Boolean).length;
      const hasLongQuote = quoted.length > 0 && quotedWords >= MIN_WORDS_IN_QUOTE;
      const hasLeakyVerb = LEAKY_VERB_PATTERN.test(node.label);

      if (hasLongQuote || hasLeakyVerb) {
        issues.push({
          ruleId: this.id,
          severity: "error",
          message: `Node "${node.id}" appears to contain literal output. Encode the plan, not the answer.`,
          nodeId: node.id,
        });
      } else {
        cleanNodes += 1;
      }
    }

    const score = (cleanNodes / graph.nodes.length) * 100;
    return { ruleId: this.id, displayName: this.displayName, score, issues };
  }
}
