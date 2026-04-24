import type { IAIProvider, IAIProviderFactory } from "../../application/services/ai-provider.js";
import { ModelRegistry, type ProviderName } from "../../application/services/model-registry.js";
import { DomainError } from "../../domain/errors/domain-error.js";

export class AIProviderFactory implements IAIProviderFactory {
  constructor(private readonly providers: Map<ProviderName, IAIProvider>) {}

  forModel(modelId: string): IAIProvider {
    const info = ModelRegistry.require(modelId);
    const provider = this.providers.get(info.provider);
    if (!provider) {
      throw new DomainError(
        "INTERNAL",
        `No provider configured for "${info.provider}". Set the corresponding API key.`,
      );
    }
    return provider;
  }
}
