import { BraidGenerator } from "../application/services/braid/braid-generator.js";
import type { GraphLinter } from "../application/services/braid/lint/graph-linter.js";
import { createDefaultGraphLinter } from "../application/services/braid/lint/default-graph-linter.js";
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
  const linter = createDefaultGraphLinter();
  return { generator, linter, cache };
};
