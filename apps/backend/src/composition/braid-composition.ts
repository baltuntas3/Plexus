import { BraidGenerator } from "../application/services/braid/braid-generator.js";
import { GraphLinter } from "../application/services/braid/lint/graph-linter.js";
import { NodeAtomicityRule } from "../application/services/braid/lint/rules/node-atomicity-rule.js";
import { AnswerLeakageRule } from "../application/services/braid/lint/rules/answer-leakage-rule.js";
import { DeterministicBranchingRule } from "../application/services/braid/lint/rules/deterministic-branching-rule.js";
import { TerminalVerificationRule } from "../application/services/braid/lint/rules/terminal-verification-rule.js";
import { GraphReachabilityRule } from "../application/services/braid/lint/rules/graph-reachability-rule.js";
import { DAGStructureRule } from "../application/services/braid/lint/rules/dag-structure-rule.js";
import { MutualExclusivityRule } from "../application/services/braid/lint/rules/mutual-exclusivity-rule.js";
import { InMemoryCacheStore } from "../infrastructure/cache/in-memory-cache-store.js";
import type { ICacheStore } from "../application/services/cache-store.js";
import type { IAIProviderFactory } from "../application/services/ai-provider.js";

export interface BraidComposition {
  generator: BraidGenerator;
  linter: GraphLinter;
  cache: ICacheStore;
}

export const createBraidComposition = (aiFactory: IAIProviderFactory): BraidComposition => {
  const cache: ICacheStore = new InMemoryCacheStore();
  const generator = new BraidGenerator(aiFactory, cache);
  const linter = new GraphLinter([
    new NodeAtomicityRule(),
    new AnswerLeakageRule(),
    new DeterministicBranchingRule(),
    new TerminalVerificationRule(),
    new GraphReachabilityRule(),
    new DAGStructureRule(),
    new MutualExclusivityRule(),
  ]);
  return { generator, linter, cache };
};
