import { DatasetGenerator } from "../dataset-generator.js";
import { FakeAIProvider, FakeAIProviderFactory } from "../../../../__tests__/fakes/fake-ai-provider.js";

const makeGenerator = (responseText: string) => {
  const provider = new FakeAIProvider(() => ({
    text: responseText,
    usage: { inputTokens: 100, outputTokens: 200 },
    model: "gpt-4o-mini",
  }));
  return new DatasetGenerator(new FakeAIProviderFactory(provider));
};

describe("DatasetGenerator", () => {
  it("parses a clean JSON array response", async () => {
    const json = JSON.stringify([
      { input: "What is 2+2?", expectedOutput: "4" },
      { input: "What is 3*3?", expectedOutput: "9" },
    ]);
    const generator = makeGenerator(json);

    const result = await generator.generate({
      taskType: "math",
      topic: "arithmetic",
      count: 2,
      model: "gpt-4o-mini",
    });

    expect(result.testCases).toHaveLength(2);
    expect(result.testCases[0]?.input).toBe("What is 2+2?");
    expect(result.testCases[0]?.expectedOutput).toBe("4");
  });

  it("extracts JSON array embedded in prose", async () => {
    const json = `Here are your test cases:\n[\n  {"input": "2+2?", "expectedOutput": "4"}\n]\nDone.`;
    const generator = makeGenerator(json);

    const result = await generator.generate({
      taskType: "math",
      topic: "arithmetic",
      count: 1,
      model: "gpt-4o-mini",
    });

    expect(result.testCases).toHaveLength(1);
  });

  it("handles null expectedOutput", async () => {
    const json = JSON.stringify([{ input: "Write a poem about stars", expectedOutput: null }]);
    const generator = makeGenerator(json);

    const result = await generator.generate({
      taskType: "creative",
      topic: "poetry",
      count: 1,
      model: "gpt-4o-mini",
    });

    expect(result.testCases[0]?.expectedOutput).toBeNull();
  });

  it("throws ValidationError when no JSON array found", async () => {
    const generator = makeGenerator("I cannot generate test cases.");

    await expect(
      generator.generate({ taskType: "math", topic: "arithmetic", count: 5, model: "gpt-4o-mini" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("throws ValidationError for malformed JSON", async () => {
    const generator = makeGenerator("[{bad json}]");

    await expect(
      generator.generate({ taskType: "math", topic: "arithmetic", count: 5, model: "gpt-4o-mini" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
