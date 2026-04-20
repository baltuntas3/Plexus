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
      model: "openai/gpt-oss-20b",
    };
  }
}

const makeFactory = (text: string): IAIProviderFactory => ({
  forModel: () => new StubProvider(text),
});

describe("TestCaseGenerator", () => {
  it("rejects runs that miss required category coverage", async () => {
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
      generator.generate("system", 7, "openai/gpt-oss-20b", 123),
    ).rejects.toThrow(/category coverage/);
  });

  it("deduplicates test cases with identical normalised inputs", async () => {
    const generator = new TestCaseGenerator(
      makeFactory(
        JSON.stringify({
          testCases: [
            { input: "What is AI?", category: "typical" },
            { input: "  what is ai?  ", category: "complex" },
            { input: "How does ML work?", category: "typical" },
          ],
        }),
      ),
    );

    await expect(
      generator.generate("system", 3, "openai/gpt-oss-20b", 123),
    ).rejects.toThrow(/2 unique cases, expected 3/);
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
      generator.generate("system", 5, "openai/gpt-oss-20b", 123),
    ).rejects.toThrow(/expected 5/);
  });
});
