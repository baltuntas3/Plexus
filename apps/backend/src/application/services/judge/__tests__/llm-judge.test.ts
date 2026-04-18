import { LLMJudge } from "../llm-judge.js";
import { JudgeExecutionError } from "../judge.js";
import {
  FakeAIProvider,
  FakeAIProviderFactory,
} from "../../../../__tests__/fakes/fake-ai-provider.js";

const buildJudge = (responseText: string) => {
  const provider = new FakeAIProvider(() => ({
    text: responseText,
    usage: { inputTokens: 50, outputTokens: 30 },
    model: "gpt-4o-mini",
  }));
  const factory = new FakeAIProviderFactory(provider);
  return {
    judge: new LLMJudge(factory, { judgeModel: "gpt-4o-mini" }),
    provider,
  };
};

describe("LLMJudge.grade", () => {
  it("parses a well-formed JSON rubric response", async () => {
    const { judge } = buildJudge(
      JSON.stringify({
        accuracy: 5,
        coherence: 4,
        instruction: 3,
        reasoning: "Generally accurate but misses a constraint.",
      }),
    );

    const result = await judge.grade({
      input: "Summarize this in one sentence.",
      candidate: "This is a one-sentence summary.",
      reference: "A concise one-sentence summary of the text.",
    });
    const score = result.score;

    expect(score.rubric).toEqual({ accuracy: 5, coherence: 4, instruction: 3 });
    expect(score.rawScore).toBeCloseTo(0.75, 6);
    expect(score.reasoning).toContain("constraint");
    expect(score.verbosityPenalty).toBe(0);
    expect(score.finalScore).toBeCloseTo(0.75, 6);
    expect(result.usage).toEqual({ inputTokens: 50, outputTokens: 30 });
    expect(result.model).toBe("gpt-4o-mini");
  });

  it("applies verbosity penalty when the candidate is much longer than the reference", async () => {
    const { judge } = buildJudge(
      JSON.stringify({
        accuracy: 5,
        coherence: 5,
        instruction: 5,
        reasoning: "Perfect content.",
      }),
    );

    const { score } = await judge.grade({
      input: "Write a short greeting.",
      candidate: "Hello there! ".repeat(200),
      reference: "Hello there!",
    });

    expect(score.rawScore).toBe(1);
    expect(score.verbosityPenalty).toBe(0.5);
    expect(score.finalScore).toBe(0.5);
  });

  it("extracts JSON even when the judge adds stray prose", async () => {
    const { judge } = buildJudge(
      `Here is the evaluation:\n{"accuracy": 4, "coherence": 4, "instruction": 4, "reasoning": "solid"}\nEnd.`,
    );

    const { score } = await judge.grade({
      input: "x",
      candidate: "y",
    });

    expect(score.rubric.accuracy).toBe(4);
    expect(score.rubric.coherence).toBe(4);
    expect(score.rubric.instruction).toBe(4);
  });

  it("rejects out-of-range rubric values with a ValidationError", async () => {
    const { judge } = buildJudge(
      JSON.stringify({
        accuracy: 7,
        coherence: 4,
        instruction: 4,
        reasoning: "bad",
      }),
    );

    await expect(
      judge.grade({ input: "x", candidate: "y" }),
    ).rejects.toThrow(/rubric validation/);
  });

  it("rejects a malformed JSON response", async () => {
    const { judge } = buildJudge("not json at all");
    await expect(judge.grade({ input: "x", candidate: "y" })).rejects.toMatchObject({
      name: "JudgeExecutionError",
      message: expect.stringMatching(/no JSON object/),
      partial: {
        usage: { inputTokens: 50, outputTokens: 30 },
        model: "gpt-4o-mini",
      },
    } satisfies Partial<JudgeExecutionError>);
  });

  it("forwards the configured judge model and a deterministic temperature", async () => {
    const { judge, provider } = buildJudge(
      JSON.stringify({
        accuracy: 3,
        coherence: 3,
        instruction: 3,
        reasoning: "ok",
      }),
    );

    await judge.grade({ input: "x", candidate: "y" });

    expect(provider.lastRequest?.model).toBe("gpt-4o-mini");
    expect(provider.lastRequest?.temperature).toBe(0);
  });
});
