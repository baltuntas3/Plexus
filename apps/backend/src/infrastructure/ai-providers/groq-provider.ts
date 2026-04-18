import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions.js";
import type {
  ChatMessage,
  GenerateRequest,
  GenerateResponse,
  IAIProvider,
} from "../../application/services/ai-provider.js";

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.6;

// Groq quirks we normalize inside this adapter:
//
// 1. Groq's reasoning-model docs ("openai/gpt-oss-*", "qwen/qwen3-*") recommend
//    putting ALL instructions into the user message rather than a system message.
//    System content is folded into the first user turn.
// 2. Reasoning token output is charged but unused by BRAID generation, so we
//    disable it by default via provider-specific extensions (`include_reasoning`
//    for GPT-OSS, `reasoning_format: "hidden"` for Qwen).
// 3. Temperature defaults to 0.6 per Groq's reasoning guide.
export class GroqProvider implements IAIProvider {
  constructor(private readonly client: OpenAI) {}

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const normalized = mergeSystemIntoUser(request.messages);

    const baseParams: ChatCompletionCreateParamsNonStreaming = {
      model: request.model,
      messages: normalized.map((m) => ({ role: m.role, content: m.content })),
      temperature: request.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
    };

    // Groq-only parameters (`include_reasoning`, `reasoning_format`) don't
    // exist on the OpenAI SDK request type, so they're attached after typing
    // and passed through as opaque fields to the Groq backend.
    const paramsWithExtras: ChatCompletionCreateParamsNonStreaming = Object.assign(
      {},
      baseParams,
      groqExtensionsFor(request.model),
    );

    const completion = await this.client.chat.completions.create(paramsWithExtras);
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

const mergeSystemIntoUser = (messages: ChatMessage[]): ChatMessage[] => {
  const systemParts: string[] = [];
  const rest: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(message.content);
    } else {
      rest.push(message);
    }
  }
  if (systemParts.length === 0) return rest;

  const systemBlock = systemParts.join("\n\n");
  const firstUserIndex = rest.findIndex((m) => m.role === "user");
  if (firstUserIndex === -1) {
    return [{ role: "user", content: systemBlock }, ...rest];
  }
  const prefixed: ChatMessage[] = [...rest];
  const target = prefixed[firstUserIndex];
  if (target) {
    prefixed[firstUserIndex] = {
      role: "user",
      content: `${systemBlock}\n\n${target.content}`,
    };
  }
  return prefixed;
};

const groqExtensionsFor = (modelId: string): Record<string, unknown> => {
  if (modelId.startsWith("openai/gpt-oss")) {
    return { reasoning_effort: "low", include_reasoning: false };
  }
  if (modelId.startsWith("qwen/")) {
    return { reasoning_format: "hidden" };
  }
  return {};
};
