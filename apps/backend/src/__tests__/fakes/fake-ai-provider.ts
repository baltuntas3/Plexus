import type {
  GenerateRequest,
  GenerateResponse,
  IAIProvider,
  IAIProviderFactory,
} from "../../application/services/ai-provider.js";

export class FakeAIProvider implements IAIProvider {
  public calls = 0;
  public lastRequest: GenerateRequest | null = null;

  constructor(private readonly responder: (req: GenerateRequest) => GenerateResponse) {}

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    this.calls += 1;
    this.lastRequest = request;
    return this.responder(request);
  }
}

export class FakeAIProviderFactory implements IAIProviderFactory {
  constructor(private readonly provider: IAIProvider) {}

  forModel(_modelId: string): IAIProvider {
    return this.provider;
  }
}
