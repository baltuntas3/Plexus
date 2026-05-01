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
    model: "openai/gpt-oss-20b",
  }));
  const factory = new FakeAIProviderFactory(provider);
  return {
    judge: new LLMJudge(factory, { judgeModel: "openai/gpt-oss-20b" }),
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
    expect(result.model).toBe("openai/gpt-oss-20b");
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

  it("applies brevity penalty when the candidate is much shorter than the reference", async () => {
    const { judge } = buildJudge(
      JSON.stringify({
        accuracy: 5,
        coherence: 5,
        instruction: 5,
        reasoning: "Too terse.",
      }),
    );

    const { score } = await judge.grade({
      input: "Summarize the policy.",
      candidate: "Approved.",
      reference: "Approved after full policy review and documented mitigation steps.",
    });

    expect(score.rawScore).toBe(1);
    expect(score.verbosityPenalty).toBeGreaterThan(0);
    expect(score.finalScore).toBeLessThan(1);
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

  it("rejects a malformed JSON response after a retry attempt", async () => {
    // The judge retries once on unparseable output, so when the provider
    // keeps returning garbage we expect the reported partial usage to cover
    // both attempts and the eventual error to mention the missing JSON.
    const { judge } = buildJudge("not json at all");
    await expect(judge.grade({ input: "x", candidate: "y" })).rejects.toMatchObject({
      name: "JudgeExecutionError",
      message: expect.stringMatching(/no JSON object/),
      partial: {
        usage: { inputTokens: 100, outputTokens: 60 },
        model: "openai/gpt-oss-20b",
      },
    } satisfies Partial<JudgeExecutionError>);
  });

  it("recovers via retry when the first response is unparseable and the second is valid", async () => {
    let callCount = 0;
    const provider = new FakeAIProvider(() => {
      callCount += 1;
      if (callCount === 1) {
        return {
          text: "I cannot comply with the JSON format",
          usage: { inputTokens: 50, outputTokens: 30 },
          model: "openai/gpt-oss-20b",
        };
      }
      return {
        text: JSON.stringify({
          accuracy: 4,
          coherence: 4,
          instruction: 4,
          reasoning: "retry recovered",
        }),
        usage: { inputTokens: 60, outputTokens: 20 },
        model: "openai/gpt-oss-20b",
      };
    });
    const judge = new LLMJudge(new FakeAIProviderFactory(provider), {
      judgeModel: "openai/gpt-oss-20b",
    });

    const result = await judge.grade({ input: "x", candidate: "y" });
    expect(callCount).toBe(2);
    expect(result.score.rubric).toEqual({ accuracy: 4, coherence: 4, instruction: 4 });
    expect(result.usage).toEqual({ inputTokens: 110, outputTokens: 50 });
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

    expect(provider.lastRequest?.model).toBe("openai/gpt-oss-20b");
    expect(provider.lastRequest?.temperature).toBe(0);
  });
});

describe("LLMJudge.gradeBatch", () => {
  it("delegates to grade for a single-candidate batch (no batched prompt overhead)", async () => {
    const { judge, provider } = buildJudge(
      JSON.stringify({
        accuracy: 4,
        coherence: 4,
        instruction: 4,
        reasoning: "single",
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
    // Single-candidate path uses the original (non-batched) prompt; the
    // user message embeds <candidate>, never <attempt>.
    const userMessage = String(provider.lastRequest?.messages?.at(-1)?.content ?? "");
    expect(userMessage).toContain("<candidate>");
    expect(userMessage).not.toContain("<attempt");
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

  it("computes per-candidate verbosity penalty so long attempts score lower than short ones", async () => {
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

    // Without batching, the judge would compute verbosity per call;
    // batched mode must still compute it per candidate so the long
    // attempt is penalised independently of the short one.
    const [first, second] = result.scores;
    expect(first?.verbosityPenalty).toBe(0);
    expect(second?.verbosityPenalty).toBeGreaterThan(0);
    expect(second?.finalScore).toBeLessThan(first?.finalScore ?? 0);
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
