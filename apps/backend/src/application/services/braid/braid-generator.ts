import { createHash } from "node:crypto";
import type { TaskType } from "@plexus/shared-types";
import { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import { TokenCost } from "../../../domain/value-objects/token-cost.js";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import type { IAIProviderFactory, TokenUsage } from "../ai-provider.js";
import { calculateCost } from "../model-registry.js";
import type { ICacheStore } from "../cache-store.js";
import { getGenerationPromptBuilder } from "./prompt-builder.js";

export interface BraidGenerationInput {
  classicalPrompt: string;
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

// Bump whenever generation prompt templates change so stale cache entries
// generated with older templates are not reused. Old entries will simply
// expire via TTL.
const PROMPT_TEMPLATE_VERSION = "v3-enhanced-verification-loops";

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

    const messages = getGenerationPromptBuilder(input.taskType)({
      classicalPrompt: input.classicalPrompt,
      conversationText: input.classicalPrompt,
    });

    const provider = this.providers.forModel(input.generatorModel);
    const response = await provider.generate({
      model: input.generatorModel,
      messages,
      temperature: 0,
    });

    const mermaidCode = extractMermaidCode(response.text);
    // Validate via parser; throws ValidationError on bad output.
    BraidGraph.parse(mermaidCode);

    await this.cache.set<CachedEntry>(
      key,
      { mermaidCode, usage: response.usage },
      CACHE_TTL_SECONDS,
    );

    return this.buildResult(mermaidCode, response.model, response.usage, false);
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
    hash.update(input.classicalPrompt);
    hash.update("|");
    hash.update(input.taskType);
    hash.update("|");
    hash.update(input.generatorModel);
    hash.update("|");
    hash.update(PROMPT_TEMPLATE_VERSION);
    return `braid:${hash.digest("hex")}`;
  }
}

const FENCE_REGEX = /```(?:mermaid)?\s*([\s\S]*?)```/;

const extractMermaidCode = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw ValidationError("Generator returned empty response");
  }
  const fenced = FENCE_REGEX.exec(trimmed);
  const code = fenced?.[1]?.trim() ?? trimmed;
  return code;
};
