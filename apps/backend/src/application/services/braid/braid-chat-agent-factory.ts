import type { IAIProviderFactory } from "../ai-provider.js";
import { BraidChatAgent } from "./braid-chat-agent.js";

// Produces a BraidChatAgent bound to a specific model. Injected into the
// chat use case so the use case does not reach out to the provider factory
// or `new` the agent itself — keeps the use case a pure orchestration step
// and lets tests swap the agent freely.
export interface IBraidChatAgentFactory {
  forModel(model: string): BraidChatAgent;
}

export class BraidChatAgentFactory implements IBraidChatAgentFactory {
  constructor(private readonly providers: IAIProviderFactory) {}

  forModel(model: string): BraidChatAgent {
    return new BraidChatAgent(this.providers.forModel(model), model);
  }
}
