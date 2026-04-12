import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../infrastructure/config/env.js";
import { logger } from "../infrastructure/logger/logger.js";
import type { IAIProvider, IAIProviderFactory } from "../application/services/ai-provider.js";
import type { ProviderName } from "../application/services/model-registry.js";
import { OpenAIProvider } from "../infrastructure/ai-providers/openai-provider.js";
import { AnthropicProvider } from "../infrastructure/ai-providers/anthropic-provider.js";
import { GroqProvider } from "../infrastructure/ai-providers/groq-provider.js";
import { AIProviderFactory } from "../infrastructure/ai-providers/ai-provider-factory.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export interface AIComposition {
  factory: IAIProviderFactory;
  enabledProviders: ProviderName[];
}

export const createAIComposition = (): AIComposition => {
  const providers = new Map<ProviderName, IAIProvider>();

  if (env.OPENAI_API_KEY) {
    providers.set("openai", new OpenAIProvider(new OpenAI({ apiKey: env.OPENAI_API_KEY })));
  }
  if (env.ANTHROPIC_API_KEY) {
    providers.set(
      "anthropic",
      new AnthropicProvider(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })),
    );
  }
  if (env.GROQ_API_KEY) {
    providers.set(
      "groq",
      new GroqProvider(new OpenAI({ apiKey: env.GROQ_API_KEY, baseURL: GROQ_BASE_URL })),
    );
  }

  const enabledProviders = [...providers.keys()];
  if (enabledProviders.length === 0) {
    logger.warn(
      "No AI providers configured (OPENAI_API_KEY / ANTHROPIC_API_KEY / GROQ_API_KEY missing)",
    );
  } else {
    logger.info({ providers: enabledProviders }, "AI providers initialized");
  }

  return {
    factory: new AIProviderFactory(providers),
    enabledProviders,
  };
};
