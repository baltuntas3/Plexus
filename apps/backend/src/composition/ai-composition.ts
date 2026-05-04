import OpenAI from "openai";
import { env } from "../infrastructure/config/env.js";
import { logger } from "../infrastructure/logger/logger.js";
import type { IAIProvider, IAIProviderFactory } from "../application/services/ai-provider.js";
import type { ProviderName } from "../application/services/model-registry.js";
import { GroqProvider } from "../infrastructure/ai-providers/groq-provider.js";
import { AIProviderFactory } from "../infrastructure/ai-providers/ai-provider-factory.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

interface AIComposition {
  factory: IAIProviderFactory;
}

export const createAIComposition = (): AIComposition => {
  const providers = new Map<ProviderName, IAIProvider>();

  if (env.GROQ_API_KEY) {
    providers.set(
      "groq",
      new GroqProvider(new OpenAI({ apiKey: env.GROQ_API_KEY, baseURL: GROQ_BASE_URL })),
    );
  }

  if (providers.size === 0) {
    logger.warn("No AI providers configured (GROQ_API_KEY missing)");
  } else {
    logger.info({ providers: [...providers.keys()] }, "AI providers initialized");
  }

  return {
    factory: new AIProviderFactory(providers),
  };
};
