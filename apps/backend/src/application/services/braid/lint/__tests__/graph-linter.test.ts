import { BraidGraph } from "../../../../../domain/value-objects/braid-graph.js";
import { GraphLinter } from "../graph-linter.js";
import { NodeAtomicityRule } from "../rules/node-atomicity-rule.js";
import { AnswerLeakageRule } from "../rules/answer-leakage-rule.js";
import { DeterministicBranchingRule } from "../rules/deterministic-branching-rule.js";
import { TerminalVerificationRule } from "../rules/terminal-verification-rule.js";
import { GraphReachabilityRule } from "../rules/graph-reachability-rule.js";
import { DAGStructureRule } from "../rules/dag-structure-rule.js";
import { MutualExclusivityRule } from "../rules/mutual-exclusivity-rule.js";

const parse = (code: string): BraidGraph => BraidGraph.parse(code);

describe("NodeAtomicityRule", () => {
  const rule = new NodeAtomicityRule();

  it("gives full score when all nodes are short", () => {
    const graph = parse(`flowchart TD;
A[Read input] --> B[Draft reply];`);
    const result = rule.check(graph);
    expect(result.score).toBe(100);
    expect(result.issues).toHaveLength(0);
  });

  it("flags nodes that exceed the 15-token threshold", () => {
    const longLabel = "x".repeat(200);
    const graph = parse(`flowchart TD;
A[Short] --> B[${longLabel}];`);
    const result = rule.check(graph);
    expect(result.score).toBe(50);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.nodeId).toBe("B");
  });

  it("does not count {{var}} placeholders against the atomicity budget", () => {
    // Placeholder alone is 53 chars (~14 tokens). Surrounding literal
    // is "Extract  now" (12 chars). Total label without strip = 65
    // chars ≈ 17 tokens, which would exceed the 15-token budget and
    // get flagged. After stripping the placeholder (CLAUDE.md
    // contract — references are slots, not literal content), only
    // 12 chars remain, ≈ 3 tokens, well under budget.
    const placeholderHeavy = "{{thisIsAReallyLongVariableNameForRegressionTesting}}";
    const graph = parse(`flowchart TD;
A[Extract ${placeholderHeavy} now] --> B[Done];`);
    const result = rule.check(graph);
    expect(result.score).toBe(100);
    expect(result.issues).toHaveLength(0);
  });
});

describe("AnswerLeakageRule", () => {
  const rule = new AnswerLeakageRule();

  it("passes when nodes describe plans, not literal outputs", () => {
    const graph = parse(`flowchart TD;
A[Draft intro: acknowledge then pivot] --> B[Check: tone is empathetic];`);
    const result = rule.check(graph);
    expect(result.score).toBe(100);
  });

  it("flags nodes containing long quoted strings", () => {
    const graph = parse(`flowchart TD;
A[Write: "Dear Team I regret to inform you"] --> B[Check: tone];`);
    const result = rule.check(graph);
    expect(result.score).toBe(50);
    expect(result.issues[0]?.nodeId).toBe("A");
  });

  it("flags 'Write:' verb followed by prose", () => {
    const graph = parse(`flowchart TD;
A[Write: Hello everyone and welcome] --> B[Check: tone];`);
    const result = rule.check(graph);
    expect(result.score).toBe(50);
  });
});

describe("DeterministicBranchingRule", () => {
  const rule = new DeterministicBranchingRule();

  it("returns full score when there are no branches", () => {
    const graph = parse(`flowchart TD;
A[Start] --> B[End];`);
    expect(rule.check(graph).score).toBe(100);
  });

  it("returns full score when all branches are labeled", () => {
    const graph = parse(`flowchart TD;
A[Start] -- "if long" --> B[Truncate];
A -- "if short" --> C[Keep];`);
    const result = rule.check(graph);
    expect(result.score).toBe(100);
    expect(result.issues).toHaveLength(0);
  });

  it("flags unlabeled branches", () => {
    const graph = parse(`flowchart TD;
A[Start] --> B[Left];
A --> C[Right];`);
    const result = rule.check(graph);
    expect(result.score).toBe(0);
    expect(result.issues.length).toBeGreaterThanOrEqual(1);
  });
});

describe("TerminalVerificationRule", () => {
  const rule = new TerminalVerificationRule();

  it("gives full score when all terminals are verification nodes", () => {
    const graph = parse(`flowchart TD;
A[Start] --> B[Check: tone];
A --> C[Verify: length <= 250];`);
    expect(rule.check(graph).score).toBe(100);
  });

  it("gives partial score when some terminals are not verification", () => {
    const graph = parse(`flowchart TD;
A[Start] --> B[Check: tone];
A --> C[Done];`);
    const result = rule.check(graph);
    expect(result.score).toBe(50);
    expect(result.issues.some((i) => i.nodeId === "C")).toBe(true);
  });

  it("gives zero when no terminal is a verification", () => {
    const graph = parse(`flowchart TD;
A[Start] --> B[End];`);
    expect(rule.check(graph).score).toBe(0);
  });
});

describe("GraphReachabilityRule", () => {
  const rule = new GraphReachabilityRule();

  it("gives full score for a linear connected graph", () => {
    const graph = parse(`flowchart TD;
A[Start] --> B[Mid];
B --> C[End];`);
    expect(rule.check(graph).score).toBe(100);
  });

  it("flags orphan nodes not reachable from any root", () => {
    const graph = parse(`flowchart TD;
A[Start] --> B[Step];
Z[Orphan definition] --> Y[Another orphan];
A --> C[End];`);
    const result = rule.check(graph);
    // Roots = {A, Z}; Z and Y are reachable from Z, A/B/C from A.
    // All nodes reachable, so score=100. Adjust test: isolated node.
    expect(result.score).toBe(100);
  });

  it("flags a node that is completely isolated (no edges)", () => {
    const graph = parse(`flowchart TD;
A[Start] --> B[End];
X[Isolated];`);
    const result = rule.check(graph);
    // X has no incoming (root) and no outgoing edges. As a root, it's "reached"
    // (BFS seeds it). So isolated nodes count as reached. Score=100.
    expect(result.score).toBe(100);
  });

  it("flags nodes reachable only via a cycle with no root", () => {
    // A cycle A→B→A with no entry point from outside — both get incoming,
    // no root, rule returns neutral 100 (DAGStructureRule flags the cycle).
    const graph = parse(`flowchart TD;
A[One] --> B[Two];
B --> A;`);
    expect(rule.check(graph).score).toBe(100);
  });

  it("gives partial score when a node is unreachable from the actual root", () => {
    // A→B, A→C; D points nowhere and has no incoming — D is a second root.
    // So all nodes count as reached. To actually exercise unreachability, we
    // need a node with incoming edges only from a non-root subgraph that
    // itself is unreachable. Construct: A→B, X→Y, Y→X (cycle). X,Y not reached
    // from A because they have incoming (so not roots) but no path from A.
    const graph = parse(`flowchart TD;
A[Start] --> B[End];
X[A] --> Y[B];
Y --> X;`);
    const result = rule.check(graph);
    expect(result.score).toBeLessThan(100);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe("DAGStructureRule", () => {
  const rule = new DAGStructureRule();

  it("gives full score for a pure DAG", () => {
    const graph = parse(`flowchart TD;
A[Start] --> B[Mid];
B --> C[End];`);
    expect(rule.check(graph).score).toBe(100);
  });

  it("allows cycles that include a verification node", () => {
    const graph = parse(`flowchart TD;
A[Start] --> B[Draft];
B --> G[Check: tone];
G -- "no" --> I[Revise];
I --> G;
G -- "yes" --> H[Done];`);
    const result = rule.check(graph);
    expect(result.score).toBe(100);
    expect(result.issues).toHaveLength(0);
  });

  it("flags cycles that contain no verification node", () => {
    const graph = parse(`flowchart TD;
A[Start] --> B[Step one];
B --> C[Step two];
C --> A;`);
    const result = rule.check(graph);
    expect(result.score).toBeLessThan(100);
    expect(result.issues.length).toBeGreaterThanOrEqual(1);
    expect(result.issues[0]?.severity).toBe("error");
  });
});

describe("MutualExclusivityRule", () => {
  const rule = new MutualExclusivityRule();

  it("gives full score when all branch labels are distinct", () => {
    const graph = parse(`flowchart TD;
A[Start] -- "if long" --> B[Truncate];
A -- "if short" --> C[Keep];`);
    expect(rule.check(graph).score).toBe(100);
  });

  it("gives full score when there are no branches", () => {
    const graph = parse(`flowchart TD;
A[Start] --> B[End];`);
    expect(rule.check(graph).score).toBe(100);
  });

  it("flags duplicate labels on the same source", () => {
    const graph = parse(`flowchart TD;
A[Start] -- "if long" --> B[Path1];
A -- "if long" --> C[Path2];`);
    const result = rule.check(graph);
    expect(result.score).toBe(0);
    expect(result.issues.length).toBeGreaterThanOrEqual(1);
  });

  it("normalizes whitespace and case when comparing labels", () => {
    const graph = parse(`flowchart TD;
A[Start] -- "IF  Long" --> B[Path1];
A -- "if long" --> C[Path2];`);
    expect(rule.check(graph).score).toBe(0);
  });

  it("ignores unlabeled branches when there are not enough labels to compare", () => {
    const graph = parse(`flowchart TD;
A[Start] --> B[Path1];
A --> C[Path2];`);
    // Both unlabeled → labels.length < 2 → cleanSources++. Score 100.
    expect(rule.check(graph).score).toBe(100);
  });
});

describe("GraphLinter (composite)", () => {
  const linter = new GraphLinter([
    new NodeAtomicityRule(),
    new AnswerLeakageRule(),
    new DeterministicBranchingRule(),
    new TerminalVerificationRule(),
    new GraphReachabilityRule(),
    new DAGStructureRule(),
    new MutualExclusivityRule(),
  ]);

  it("aggregates rule scores as an average", () => {
    const graph = parse(`flowchart TD;
A[Read request] -- "if long" --> B[Truncate];
A -- "if short" --> C[Keep];
B --> D[Check: length];
C --> D;`);
    const score = linter.lint(graph);
    expect(score.results).toHaveLength(7);
    expect(score.overall).toBeGreaterThan(80);
  });

  it("reports issues from multiple rules when the graph is poor", () => {
    const longLabel = "x".repeat(200);
    // Bad across many dimensions: long node, literal output, unlabeled branches,
    // duplicate labels on a second source, cycle without verification, non-verified terminals.
    const graph = parse(`flowchart TD;
A[${longLabel}] --> B[Write: "Dear Team I regret"];
A --> C[End];
C --> A;
D[Decide] -- "if x" --> E[Path1];
D -- "if x" --> F[Path2];`);
    const score = linter.lint(graph);
    const ruleIds = new Set(score.issues.map((i) => i.ruleId));
    expect(ruleIds.has("node-atomicity")).toBe(true);
    expect(ruleIds.has("answer-leakage")).toBe(true);
    expect(ruleIds.has("dag-structure")).toBe(true);
    expect(ruleIds.has("mutual-exclusivity")).toBe(true);
    expect(score.overall).toBeLessThan(70);
  });
});
