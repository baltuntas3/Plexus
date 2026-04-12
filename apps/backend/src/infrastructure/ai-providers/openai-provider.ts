import OpenAI from "openai";
import type {
  GenerateRequest,
  GenerateResponse,
  IAIProvider,
} from "../../application/services/ai-provider.js";

export class OpenAIProvider implements IAIProvider {
  constructor(private readonly client: OpenAI) {}

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const completion = await this.client.chat.completions.create({
      model: request.model,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    });

    const choice = completion.choices[0];
    const text = choice?.message?.content ?? "";

    return {
      text,
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      },
      model: completion.model,
    };
  }
}
