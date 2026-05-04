export class TokenCost {
  constructor(
    public readonly inputTokens: number,
    public readonly outputTokens: number,
    public readonly inputPricePerMillion: number,
    public readonly outputPricePerMillion: number,
  ) {}

  static zero(): TokenCost {
    return new TokenCost(0, 0, 0, 0);
  }

  get inputCostUsd(): number {
    return (this.inputTokens / 1_000_000) * this.inputPricePerMillion;
  }

  get outputCostUsd(): number {
    return (this.outputTokens / 1_000_000) * this.outputPricePerMillion;
  }

  get totalUsd(): number {
    return this.inputCostUsd + this.outputCostUsd;
  }

  get totalCents(): number {
    return this.totalUsd * 100;
  }
}
