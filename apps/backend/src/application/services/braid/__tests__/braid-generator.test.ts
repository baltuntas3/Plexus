import { BraidGenerator } from "../braid-generator.js";
import { InMemoryCacheStore } from "../../../../infrastructure/cache/in-memory-cache-store.js";
import {
  FakeAIProvider,
  FakeAIProviderFactory,
} from "../../../../__tests__/fakes/fake-ai-provider.js";
import { DomainError } from "../../../../domain/errors/domain-error.js";
import { createDefaultGraphLinter } from "../lint/default-graph-linter.js";

const VALID_GRAPH = `flowchart TD;
A[Read user request] --> B[Identify constraints];
B --> C[Draft response];
C --> D[Check: tone empathetic];`;

const makeProvider = (text: string, inputTokens = 100, outputTokens = 50): FakeAIProvider =>
  new FakeAIProvider(() => ({
    text,
    usage: { inputTokens, outputTokens },
    model: "openai/gpt-oss-20b",
  }));

const makeGenerator = (provider: FakeAIProvider): BraidGenerator =>
  new BraidGenerator(
    new FakeAIProviderFactory(provider),
    new InMemoryCacheStore(),
    createDefaultGraphLinter(),
  );

describe("BraidGenerator", () => {
  it("generates and parses a valid BRAID graph", async () => {
    const provider = makeProvider(VALID_GRAPH);
    const generator = makeGenerator(provider);

    const result = await generator.generate({
      sourcePrompt: "Summarize the text",
      taskType: "general",
      generatorModel: "openai/gpt-oss-20b",
    });

    expect(result.cached).toBe(false);
    expect(result.graph.nodes.length).toBe(4);
    expect(result.usage.inputTokens).toBe(100);
    expect(result.cost.totalUsd).toBeGreaterThan(0);
    expect(provider.calls).toBe(1);
  });

  it("strips markdown code fences around Mermaid output", async () => {
    const provider = makeProvider(`\`\`\`mermaid\n${VALID_GRAPH}\n\`\`\``);
    const generator = makeGenerator(provider);

    const result = await generator.generate({
      sourcePrompt: "Summarize the text",
      taskType: "general",
      generatorModel: "openai/gpt-oss-20b",
    });
    expect(result.graph.nodes.length).toBe(4);
  });

  it("returns cached result on second call with same input", async () => {
    const provider = makeProvider(VALID_GRAPH);
    const generator = makeGenerator(provider);

    await generator.generate({
      sourcePrompt: "Summarize",
      taskType: "general",
      generatorModel: "openai/gpt-oss-20b",
    });
    const second = await generator.generate({
      sourcePrompt: "Summarize",
      taskType: "general",
      generatorModel: "openai/gpt-oss-20b",
    });

    expect(provider.calls).toBe(1);
    expect(second.cached).toBe(true);
  });

  it("bypasses cache when forceRegenerate is true", async () => {
    const provider = makeProvider(VALID_GRAPH);
    const generator = makeGenerator(provider);

    await generator.generate({
      sourcePrompt: "Summarize",
      taskType: "general",
      generatorModel: "openai/gpt-oss-20b",
    });
    await generator.generate({
      sourcePrompt: "Summarize",
      taskType: "general",
      generatorModel: "openai/gpt-oss-20b",
      forceRegenerate: true,
    });

    expect(provider.calls).toBe(2);
  });

  it("re-fetches when sourcePrompt changes", async () => {
    const provider = makeProvider(VALID_GRAPH);
    const generator = makeGenerator(provider);

    await generator.generate({
      sourcePrompt: "Summarize A",
      taskType: "general",
      generatorModel: "openai/gpt-oss-20b",
    });
    await generator.generate({
      sourcePrompt: "Summarize B",
      taskType: "general",
      generatorModel: "openai/gpt-oss-20b",
    });

    expect(provider.calls).toBe(2);
  });

  it("throws on empty generator output", async () => {
    const provider = makeProvider("");
    const generator = makeGenerator(provider);

    await expect(
      generator.generate({
        sourcePrompt: "Summarize",
        taskType: "general",
        generatorModel: "openai/gpt-oss-20b",
      }),
    ).rejects.toThrow(DomainError);
  });

  it("throws on invalid Mermaid output", async () => {
    const provider = makeProvider("this is not mermaid");
    const generator = makeGenerator(provider);

    await expect(
      generator.generate({
        sourcePrompt: "Summarize",
        taskType: "general",
        generatorModel: "openai/gpt-oss-20b",
      }),
    ).rejects.toThrow(DomainError);
  });

  it("does not cache failed generations", async () => {
    const provider = makeProvider("bad output");
    const generator = makeGenerator(provider);

    await expect(
      generator.generate({
        sourcePrompt: "Summarize",
        taskType: "general",
        generatorModel: "openai/gpt-oss-20b",
      }),
    ).rejects.toThrow(DomainError);

    await expect(
      generator.generate({
        sourcePrompt: "Summarize",
        taskType: "general",
        generatorModel: "openai/gpt-oss-20b",
      }),
    ).rejects.toThrow(DomainError);

    expect(provider.calls).toBe(4);
  });

  it("repairs a graph with lint issues once before caching", async () => {
    const leakyGraph = `flowchart TD;
A[Write: Hello user directly] --> B[Check: final answer];`;
    const responses = [leakyGraph, VALID_GRAPH];
    const provider = new FakeAIProvider(() => {
      const text = responses.shift() ?? VALID_GRAPH;
      return {
        text,
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "openai/gpt-oss-20b",
      };
    });
    const generator = makeGenerator(provider);

    const result = await generator.generate({
      sourcePrompt: "Summarize",
      taskType: "general",
      generatorModel: "openai/gpt-oss-20b",
    });
    const cached = await generator.generate({
      sourcePrompt: "Summarize",
      taskType: "general",
      generatorModel: "openai/gpt-oss-20b",
    });

    expect(provider.calls).toBe(2);
    expect(result.cached).toBe(false);
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 100 });
    expect(cached.cached).toBe(true);
    expect(cached.graph.mermaidCode).toBe(VALID_GRAPH);
  });
});
