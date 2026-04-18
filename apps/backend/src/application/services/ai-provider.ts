export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface GenerateRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  // Deterministic sampling seed. Providers that do not support seeds (e.g.
  // Anthropic) are expected to ignore this field silently.
  seed?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateResponse {
  text: string;
  usage: TokenUsage;
  model: string;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly partial?: Partial<GenerateResponse>,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "AIProviderError";
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export interface IAIProvider {
  generate(request: GenerateRequest): Promise<GenerateResponse>;
}

export interface IAIProviderFactory {
  forModel(modelId: string): IAIProvider;
}
