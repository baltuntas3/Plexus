import { NotFoundError, ValidationError } from "../../domain/errors/domain-error.js";
import { TokenCost } from "../../domain/value-objects/token-cost.js";

export type ProviderName = "groq";

export type ModelFamily =
  | "openai-oss"
  | "meta-llama";

export interface ModelInfo {
  id: string;
  provider: ProviderName;
  family: ModelFamily;
  displayName: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}

// NOTE: Prices in USD per 1M tokens. Verify against current vendor pricing
// before relying on cost figures in production.
const MODELS: ModelInfo[] = [
  {
    id: "llama-3.3-70b-versatile",
    provider: "groq",
    family: "meta-llama",
    displayName: "Llama 3.3 70B Versatile (Groq)",
    inputPricePerMillion: 0.59,
    outputPricePerMillion: 0.79,
  },
  {
    id: "openai/gpt-oss-120b",
    provider: "groq",
    family: "openai-oss",
    displayName: "GPT-OSS 120B (Groq)",
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
  },
  {
    id: "openai/gpt-oss-20b",
    provider: "groq",
    family: "openai-oss",
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

// Pick `count` judge models that are NOT in the same family as any solver and
// maximise family diversity. Falls back to out-of-family models sharing a
// family only when the diverse pool is exhausted, and finally to any model
// outside the solver set. Throws when no judge can be selected without
// overlapping the solver set.
export const pickJudgeModels = (
  solverModels: readonly string[],
  count: number,
): string[] => {
  if (count < 1) throw ValidationError("Judge count must be at least 1");
  const solverInfos = solverModels.map((id) => ModelRegistry.require(id));
  const solverIds = new Set(solverInfos.map((m) => m.id));
  const solverFamilies = new Set(solverInfos.map((m) => m.family));

  const outsideFamily = MODELS.filter(
    (m) => !solverIds.has(m.id) && !solverFamilies.has(m.family),
  );
  const insideFamily = MODELS.filter(
    (m) => !solverIds.has(m.id) && solverFamilies.has(m.family),
  );

  const picked: ModelInfo[] = [];
  const usedFamilies = new Set<ModelFamily>();
  for (const candidate of outsideFamily) {
    if (picked.length >= count) break;
    if (usedFamilies.has(candidate.family)) continue;
    picked.push(candidate);
    usedFamilies.add(candidate.family);
  }
  if (picked.length < count) {
    for (const candidate of outsideFamily) {
      if (picked.length >= count) break;
      if (picked.some((m) => m.id === candidate.id)) continue;
      picked.push(candidate);
    }
  }
  if (picked.length < count) {
    for (const candidate of insideFamily) {
      if (picked.length >= count) break;
      picked.push(candidate);
    }
  }
  if (picked.length === 0) {
    throw ValidationError(
      "No judge models available outside the solver set — add more models or reduce the solver list",
    );
  }
  return picked.map((m) => m.id);
};

// Pick a generator model that is not in the solver set, preferring a family
// outside the solver families so the generator cannot favour its own family's
// response style.
export const pickGeneratorModel = (
  solverModels: readonly string[],
  preferred: string,
): string => {
  const solverInfos = solverModels.map((id) => ModelRegistry.require(id));
  const solverIds = new Set(solverInfos.map((m) => m.id));
  const solverFamilies = new Set(solverInfos.map((m) => m.family));
  const preferredInfo = ModelRegistry.lookup(preferred);
  if (
    preferredInfo &&
    !solverIds.has(preferredInfo.id) &&
    !solverFamilies.has(preferredInfo.family)
  ) {
    return preferredInfo.id;
  }
  const outsideFamily = MODELS.find(
    (m) => !solverIds.has(m.id) && !solverFamilies.has(m.family),
  );
  if (outsideFamily) return outsideFamily.id;
  const outsideSet = MODELS.find((m) => !solverIds.has(m.id));
  if (outsideSet) return outsideSet.id;
  throw ValidationError(
    "No generator model available outside the solver set — add more models or reduce the solver list",
  );
};
