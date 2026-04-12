import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatMessage,
  GenerateRequest,
  GenerateResponse,
  IAIProvider,
} from "../../application/services/ai-provider.js";

const DEFAULT_MAX_TOKENS = 4096;

export class AnthropicProvider implements IAIProvider {
  constructor(private readonly client: Anthropic) {}

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const { systemPrompt, conversation } = splitMessages(request.messages);

    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      messages: conversation.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    });

    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");

    return {
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      model: response.model,
    };
  }
}

interface SplitMessages {
  systemPrompt: string | null;
  conversation: ChatMessage[];
}

const splitMessages = (messages: ChatMessage[]): SplitMessages => {
  const systemParts: string[] = [];
  const conversation: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(message.content);
    } else {
      conversation.push(message);
    }
  }
  return {
    systemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : null,
    conversation,
  };
};
