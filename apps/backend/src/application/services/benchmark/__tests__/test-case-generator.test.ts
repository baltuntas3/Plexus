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
  it("requires full category coverage when count reaches the full taxonomy size", async () => {
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

    await expect(
      generator.generate("system", 7, "gpt-4o-mini", 123),
    ).rejects.toThrow(/did not match required category distribution/);
  });
});
