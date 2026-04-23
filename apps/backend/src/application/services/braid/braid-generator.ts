import { createHash } from "node:crypto";
import type { TaskType } from "@plexus/shared-types";
import { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import { TokenCost } from "../../../domain/value-objects/token-cost.js";
import type { IAIProviderFactory, TokenUsage } from "../ai-provider.js";
import { calculateCost } from "../model-registry.js";
import type { ICacheStore } from "../cache-store.js";
import { BraidAgentExecutor } from "./braid-agent-executor.js";

export interface BraidGenerationInput {
  sourcePrompt: string;
  taskType: TaskType;
  generatorModel: string;
  forceRegenerate?: boolean;
}

export interface BraidGenerationResult {
  graph: BraidGraph;
  generatorModel: string;
  usage: TokenUsage;
  cost: TokenCost;
  cached: boolean;
}

interface CachedEntry {
  mermaidCode: string;
  usage: TokenUsage;
}

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

// Bump whenever the agent graph or executor logic changes so stale cache
// entries generated with older templates are not reused.
const PROMPT_TEMPLATE_VERSION = "v4-braid-agent-executor";

export class BraidGenerator {
  constructor(
    private readonly providers: IAIProviderFactory,
    private readonly cache: ICacheStore,
  ) {}

  async generate(input: BraidGenerationInput): Promise<BraidGenerationResult> {
    const key = this.cacheKey(input);

    if (!input.forceRegenerate) {
      const hit = await this.cache.get<CachedEntry>(key);
      if (hit) {
        return this.buildResult(hit.mermaidCode, input.generatorModel, hit.usage, true);
      }
    }

    const provider = this.providers.forModel(input.generatorModel);
    const executor = new BraidAgentExecutor(provider, input.generatorModel);
    const agentResult = await executor.execute(input.sourcePrompt, input.taskType);

    const mermaidCode = agentResult.mermaidCode;
    // Validate via parser; throws ValidationError on bad output.
    BraidGraph.parse(mermaidCode);

    const usage: TokenUsage = {
      inputTokens: agentResult.totalInputTokens,
      outputTokens: agentResult.totalOutputTokens,
    };

    await this.cache.set<CachedEntry>(key, { mermaidCode, usage }, CACHE_TTL_SECONDS);

    return this.buildResult(mermaidCode, input.generatorModel, usage, false);
  }

  private buildResult(
    mermaidCode: string,
    generatorModel: string,
    usage: TokenUsage,
    cached: boolean,
  ): BraidGenerationResult {
    const graph = BraidGraph.parse(mermaidCode);
    const cost = calculateCost(generatorModel, usage.inputTokens, usage.outputTokens);
    return { graph, generatorModel, usage, cost, cached };
  }

  private cacheKey(input: BraidGenerationInput): string {
    const hash = createHash("sha256");
    hash.update(input.sourcePrompt);
    hash.update("|");
    hash.update(input.taskType);
    hash.update("|");
    hash.update(input.generatorModel);
    hash.update("|");
    hash.update(PROMPT_TEMPLATE_VERSION);
    return `braid:${hash.digest("hex")}`;
  }
}

