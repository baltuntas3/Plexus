import { AnswerLeakageRule } from "./rules/answer-leakage-rule.js";
import { DAGStructureRule } from "./rules/dag-structure-rule.js";
import { DeterministicBranchingRule } from "./rules/deterministic-branching-rule.js";
import { GraphReachabilityRule } from "./rules/graph-reachability-rule.js";
import { MutualExclusivityRule } from "./rules/mutual-exclusivity-rule.js";
import { NodeAtomicityRule } from "./rules/node-atomicity-rule.js";
import { TerminalVerificationRule } from "./rules/terminal-verification-rule.js";
import { GraphLinter } from "./graph-linter.js";

// Canonical rule set the production linter applies. Centralised so
// composition + tests share the exact list — paper §A.4 enumerates 4
// principles, expanded here into 7 concrete rules (atomicity, no
// leakage, deterministic branching, terminal verification, plus DAG
// structure, reachability, and mutual exclusivity supporting checks).
export const createDefaultGraphLinter = (): GraphLinter =>
  new GraphLinter([
    new NodeAtomicityRule(),
    new AnswerLeakageRule(),
    new DeterministicBranchingRule(),
    new TerminalVerificationRule(),
    new GraphReachabilityRule(),
    new DAGStructureRule(),
    new MutualExclusivityRule(),
  ]);
