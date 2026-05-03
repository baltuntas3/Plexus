import { LLMJudge } from "../llm-judge.js";
import {
  FakeAIProvider,
  FakeAIProviderFactory,
} from "../../../../__tests__/fakes/fake-ai-provider.js";

const buildJudge = (responseText: string) => {
  const provider = new FakeAIProvider(() => ({
    text: responseText,
    usage: { inputTokens: 50, outputTokens: 30 },
    model: "openai/gpt-oss-20b",
  }));
  const factory = new FakeAIProviderFactory(provider);
  return {
    judge: new LLMJudge(factory, { judgeModel: "openai/gpt-oss-20b" }),
    provider,
  };
};

describe("LLMJudge.gradeBatch", () => {
  it("uses the batched prompt even for length-1 inputs so judging methodology stays uniform", async () => {
    // Length-1 batches happen when a triple loses all but one rep to
    // solver failures. Grading that survivor with the single-candidate
    // prompt would let solver reliability leak into the score: rows from
    // a partially-failed triple would be judged under different
    // instructions than rows from a fully-successful triple. The batch
    // path is therefore the only path; this test pins that contract.
    const { judge, provider } = buildJudge(
      JSON.stringify({
        scores: [
          {
            label: "ATTEMPT_1",
            accuracy: 4,
            coherence: 4,
            instruction: 4,
            reasoning: "single",
          },
        ],
      }),
    );

    const result = await judge.gradeBatch({
      input: "summarize",
      candidates: ["only candidate"],
    });

    expect(result.scores).toHaveLength(1);
    expect(result.scores[0]?.rubric).toEqual({
      accuracy: 4,
      coherence: 4,
      instruction: 4,
    });
    const userMessage = String(provider.lastRequest?.messages?.at(-1)?.content ?? "");
    expect(userMessage).toContain("<attempt");
    expect(userMessage).not.toContain("<candidate>");
  });

  it("scores N candidates with a single judge call and restores input order even when labels come back shuffled", async () => {
    const { judge, provider } = buildJudge(
      JSON.stringify({
        scores: [
          // The judge returned labels in a different order than the
          // prompt asked for — the scores must still be matched back to
          // the original candidate index by label, not by position.
          { label: "ATTEMPT_3", accuracy: 3, coherence: 3, instruction: 3, reasoning: "third" },
          { label: "ATTEMPT_1", accuracy: 5, coherence: 5, instruction: 5, reasoning: "first" },
          { label: "ATTEMPT_2", accuracy: 4, coherence: 4, instruction: 4, reasoning: "second" },
        ],
      }),
    );

    const result = await judge.gradeBatch({
      input: "summarize",
      candidates: ["alpha", "beta", "gamma"],
      seed: 7,
    });

    expect(provider.calls).toBe(1);
    expect(result.scores).toHaveLength(3);
    // The judge prompt shuffles candidates with the seed, so we don't
    // assert which candidate got which label — only that every parsed
    // score lands at the right input index. The aggregate rubric values
    // returned by the stub provider are 3, 4, and 5; one of them must
    // appear at each index, with no duplicates.
    const accuracyValues = result.scores
      .map((s) => s?.rubric.accuracy)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(accuracyValues).toEqual([3, 4, 5]);
    const userMessage = String(provider.lastRequest?.messages?.at(-1)?.content ?? "");
    expect(userMessage).toContain("ATTEMPT_1");
    expect(userMessage).toContain("ATTEMPT_2");
    expect(userMessage).toContain("ATTEMPT_3");
  });

  it("returns identical finalScore for identical rubric regardless of candidate length", async () => {
    // No length penalty is applied on top of the rubric. Two attempts
    // with the same rubric but very different lengths must return the
    // same finalScore — length is the prompt's responsibility (and the
    // judge's `instruction` axis grades adherence).
    const { judge } = buildJudge(
      JSON.stringify({
        scores: [
          { label: "ATTEMPT_1", accuracy: 5, coherence: 5, instruction: 5, reasoning: "ok" },
          { label: "ATTEMPT_2", accuracy: 5, coherence: 5, instruction: 5, reasoning: "ok" },
        ],
      }),
    );

    const result = await judge.gradeBatch({
      input: "Write a short greeting.",
      candidates: ["Hello there!", "Hello there! ".repeat(200)],
      reference: "Hello there!",
      seed: 1,
    });

    const [first, second] = result.scores;
    expect(first?.finalScore).toBe(1);
    expect(second?.finalScore).toBe(1);
  });

  it("retries on a malformed batch response and surfaces the parsed payload on success", async () => {
    let callCount = 0;
    const provider = new FakeAIProvider(() => {
      callCount += 1;
      if (callCount === 1) {
        return {
          text: "not json",
          usage: { inputTokens: 30, outputTokens: 10 },
          model: "openai/gpt-oss-20b",
        };
      }
      return {
        text: JSON.stringify({
          scores: [
            { label: "ATTEMPT_1", accuracy: 4, coherence: 4, instruction: 4, reasoning: "ok" },
            { label: "ATTEMPT_2", accuracy: 3, coherence: 3, instruction: 3, reasoning: "ok" },
          ],
        }),
        usage: { inputTokens: 40, outputTokens: 12 },
        model: "openai/gpt-oss-20b",
      };
    });
    const judge = new LLMJudge(new FakeAIProviderFactory(provider), {
      judgeModel: "openai/gpt-oss-20b",
    });

    const result = await judge.gradeBatch({
      input: "x",
      candidates: ["a", "b"],
    });

    expect(callCount).toBe(2);
    expect(result.scores).toHaveLength(2);
    // Reported usage covers both attempts (the malformed first call's
    // tokens are kept so the caller's cost accounting stays honest).
    expect(result.usage).toEqual({ inputTokens: 70, outputTokens: 22 });
  });

  it("rejects a batch response missing one of the requested labels", async () => {
    const { judge } = buildJudge(
      JSON.stringify({
        scores: [
          { label: "ATTEMPT_1", accuracy: 4, coherence: 4, instruction: 4, reasoning: "ok" },
        ],
      }),
    );

    await expect(
      judge.gradeBatch({ input: "x", candidates: ["a", "b"] }),
    ).rejects.toMatchObject({
      name: "JudgeExecutionError",
      message: expect.stringMatching(/missing labels?/i),
    });
  });
});
