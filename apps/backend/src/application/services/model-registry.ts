import { NotFoundError } from "../../domain/errors/domain-error.js";
import { TokenCost } from "../../domain/value-objects/token-cost.js";

export type ProviderName = "openai" | "anthropic" | "groq";

export interface ModelInfo {
  id: string;
  provider: ProviderName;
  displayName: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}

// NOTE: Prices in USD per 1M tokens. Verify against current vendor pricing
// before relying on cost figures in production.
const MODELS: ModelInfo[] = [
  {
    id: "gpt-4o",
    provider: "openai",
    displayName: "GPT-4o",
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10.0,
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    displayName: "GPT-4o mini",
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
  },
  {
    id: "claude-opus-4-6",
    provider: "anthropic",
    displayName: "Claude Opus 4.6",
    inputPricePerMillion: 15.0,
    outputPricePerMillion: 75.0,
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    displayName: "Claude Sonnet 4.6",
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    displayName: "Claude Haiku 4.5",
    inputPricePerMillion: 1.0,
    outputPricePerMillion: 5.0,
  },
  // Groq — OpenAI-compatible endpoint, reasoning models for BRAID generation.
  {
    id: "openai/gpt-oss-120b",
    provider: "groq",
    displayName: "GPT-OSS 120B (Groq)",
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
  },
  {
    id: "openai/gpt-oss-20b",
    provider: "groq",
    displayName: "GPT-OSS 20B (Groq)",
    inputPricePerMillion: 0.075,
    outputPricePerMillion: 0.3,
  },
];

export const ModelRegistry = {
  list(): readonly ModelInfo[] {
    return MODELS;
  },
  lookup(id: string): ModelInfo | null {
    return MODELS.find((m) => m.id === id) ?? null;
  },
  require(id: string): ModelInfo {
    const info = this.lookup(id);
    if (!info) {
      throw NotFoundError(`Unknown model: ${id}`);
    }
    return info;
  },
  byProvider(provider: ProviderName): ModelInfo[] {
    return MODELS.filter((m) => m.provider === provider);
  },
};

export const calculateCost = (
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): TokenCost => {
  const info = ModelRegistry.require(modelId);
  return new TokenCost(
    inputTokens,
    outputTokens,
    info.inputPricePerMillion,
    info.outputPricePerMillion,
  );
};
