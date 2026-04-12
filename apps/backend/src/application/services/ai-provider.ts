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

export interface IAIProvider {
  generate(request: GenerateRequest): Promise<GenerateResponse>;
}

export interface IAIProviderFactory {
  forModel(modelId: string): IAIProvider;
}
