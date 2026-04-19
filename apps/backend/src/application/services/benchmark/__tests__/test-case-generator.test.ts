import type {
  GenerateRequest,
  IAIProvider,
  IAIProviderFactory,
} from "../../ai-provider.js";
import { TestCaseGenerator } from "../test-case-generator.js";

class StubProvider implements IAIProvider {
  constructor(private readonly text: string) {}

  async generate(_request: GenerateRequest) {
    return {
      text: this.text,
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "gpt-4o-mini",
    };
  }
}

const makeFactory = (text: string): IAIProviderFactory => ({
  forModel: () => new StubProvider(text),
});

describe("TestCaseGenerator", () => {
  it("accepts whatever category labels the model returns as long as the count and shape match", async () => {
    // The generator used to reject runs when the model's category mix did
    // not exactly match the advisory plan (modulo bucket assignment). That
    // failed too often in practice — the distribution is advisory, the user
    // can retag cases in the UI, and a whole-benchmark abort over a single
    // stray label is a worse outcome than accepting the skew.
    const generator = new TestCaseGenerator(
      makeFactory(
        JSON.stringify({
          testCases: Array.from({ length: 7 }, (_, i) => ({
            input: `question ${i + 1}`,
            category: "typical",
          })),
        }),
      ),
    );

    const cases = await generator.generate("system", 7, "gpt-4o-mini", 123);
    expect(cases).toHaveLength(7);
    expect(cases.every((c) => c.category === "typical")).toBe(true);
  });

  it("still rejects runs where the generator returned the wrong number of cases", async () => {
    const generator = new TestCaseGenerator(
      makeFactory(
        JSON.stringify({
          testCases: [{ input: "only one", category: "typical" }],
        }),
      ),
    );

    await expect(
      generator.generate("system", 5, "gpt-4o-mini", 123),
    ).rejects.toThrow(/expected 5/);
  });
});
