import { BraidGenerator } from "../application/services/braid/braid-generator.js";
import type { GraphLinter } from "../application/services/braid/lint/graph-linter.js";
import { createDefaultGraphLinter } from "../application/services/braid/lint/default-graph-linter.js";
import { InMemoryCacheStore } from "../infrastructure/cache/in-memory-cache-store.js";
import type { IAIProviderFactory } from "../application/services/ai-provider.js";

interface BraidComposition {
  generator: BraidGenerator;
  linter: GraphLinter;
}

export const createBraidComposition = (aiFactory: IAIProviderFactory): BraidComposition => {
  const linter = createDefaultGraphLinter();
  const generator = new BraidGenerator(aiFactory, new InMemoryCacheStore(), linter);
  return { generator, linter };
};
