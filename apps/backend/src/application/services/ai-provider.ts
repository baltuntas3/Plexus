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
  // Ask the provider to constrain output to a JSON object. Eliminates the
  // markdown-fence / prose-prefix failure mode when the caller plans to
  // JSON.parse the response. Providers that do not support structured
  // output ignore this silently — callers must still defend against parse
  // errors at the boundary.
  responseFormat?: "json";
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
