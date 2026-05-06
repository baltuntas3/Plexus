import { z } from "zod";
import type { TaskType } from "@plexus/shared-types";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import { buildJudgeScore, type JudgeScore } from "../../../domain/value-objects/judge-score.js";
import { extractJsonObject } from "../../utils/extract-json-object.js";
import type { IAIProviderFactory } from "../ai-provider.js";
import {
  JudgeExecutionError,
  type BatchJudgeInput,
  type BatchJudgeResult,
  type IJudge,
} from "./judge.js";
import { buildBatchJudgeMessages } from "./judge-prompt.js";

interface LLMJudgeConfig {
  judgeModel: string;
  taskType?: TaskType;
}

// Judges always run at T=0. The explicit `0` is load-bearing — providers
// default temperature to non-zero values (e.g. Groq 0.6, OpenAI / Anthropic
// 1.0) when the field is omitted, which would flip judging to stochastic
// mode and inflate every downstream uncertainty estimate.
//
// T=0 is a variance-floor policy, not a determinism guarantee — LLMs are
// not bit-stable at T=0+seed (FP reduction order, MoE routing, provider
// quantization; Anthropic ignores `seed` outright). Reproducibility for
// the analyzer comes from the persisted vote rows, not from re-calling
// the judge. The residual judge noise that remains at T=0 is small
// relative to between-input variance, so the cluster-bootstrap CI is a
// mild underestimate rather than a manufactured one; raising temperature
// would inflate that bias meaningfully and bias the paired tie-break
// toward spurious wins instead of conservative ties. Stochastic judging
// is intentionally not exposed as a knob — it would need its own class
// to keep the policy explicit at the type level.
const JUDGE_TEMPERATURE = 0;

const batchRubricSchema = z.object({
  scores: z
    .array(
      z.object({
        label: z.string().min(1),
        accuracy: z.number().int().min(1).max(5),
        coherence: z.number().int().min(1).max(5),
        instruction: z.number().int().min(1).max(5),
        reasoning: z.string().min(1),
      }),
    )
    .min(1),
});

export class LLMJudge implements IJudge {
  constructor(
    private readonly providers: IAIProviderFactory,
    private readonly config: LLMJudgeConfig,
  ) {}

  async gradeBatch(input: BatchJudgeInput): Promise<BatchJudgeResult> {
    if (input.candidates.length === 0) {
      throw ValidationError("gradeBatch requires at least one candidate");
    }
    // Length-1 batches still go through the batch prompt. Routing them to
    // a single-candidate prompt would judge survivors of a partially-failed
    // triple under different instructions than rows from a fully-successful
    // one, letting solver reliability leak into the score. The prompt is
    // uniform across the benchmark; this is a fairness contract.
    const provider = this.providers.forModel(this.config.judgeModel);
    const built = buildBatchJudgeMessages(input, this.config.taskType);
    const response = await provider.generate({
      model: this.config.judgeModel,
      messages: built.messages,
      temperature: JUDGE_TEMPERATURE,
      seed: input.seed,
      responseFormat: "json",
    });

    let parsed: z.infer<typeof batchRubricSchema>;
    let totalInputTokens = response.usage.inputTokens;
    let totalOutputTokens = response.usage.outputTokens;
    let lastModel = response.model;
    try {
      parsed = parseBatchRubric(response.text, built.labelToOriginalIndex);
    } catch (firstErr) {
      // Defensive retry on parse failure. A fully deterministic provider
      // (T=0 + same seed) would re-emit the same bytes here, but parse
      // failures in practice come from two sources where retry IS useful:
      //   (a) providers that ignore `seed` (Anthropic) sample a fresh
      //       token stream on every call, so the retry can land valid
      //       JSON where the first attempt did not.
      //   (b) providers that respect the seed but still produce sporadic
      //       JSON-mode glitches under load — a fresh request bypasses
      //       any per-connection state that contributed to the glitch.
      // Echoing the bad assistant turn back would roughly double input
      // tokens for an N-candidate batched prompt; a fresh deterministic
      // call is cheaper and recovery rate is empirically high enough
      // that it is worth the single extra round-trip.
      try {
        const retry = await provider.generate({
          model: this.config.judgeModel,
          messages: built.messages,
          temperature: JUDGE_TEMPERATURE,
          seed: input.seed,
          responseFormat: "json",
        });
        totalInputTokens += retry.usage.inputTokens;
        totalOutputTokens += retry.usage.outputTokens;
        lastModel = retry.model;
        parsed = parseBatchRubric(retry.text, built.labelToOriginalIndex);
      } catch (retryErr) {
        const cause = retryErr instanceof Error ? retryErr : firstErr;
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new JudgeExecutionError(message, {
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
          model: lastModel,
        }, { cause });
      }
    }

    try {
      const orderedScores: JudgeScore[] = new Array(input.candidates.length);
      for (const entry of parsed.scores) {
        const originalIndex = built.labelToOriginalIndex.get(entry.label);
        if (originalIndex === undefined) {
          throw ValidationError(
            `Batch judge returned an unknown label "${entry.label}"`,
          );
        }
        orderedScores[originalIndex] = buildJudgeScore(
          {
            accuracy: entry.accuracy,
            coherence: entry.coherence,
            instruction: entry.instruction,
          },
          entry.reasoning,
        );
      }
      const missing = orderedScores.findIndex((score) => score === undefined);
      if (missing !== -1) {
        throw ValidationError(
          `Batch judge missing score for candidate at index ${missing}`,
        );
      }
      return {
        scores: orderedScores,
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        model: lastModel,
      };
    } catch (err) {
      if (err instanceof Error) {
        throw new JudgeExecutionError(err.message, {
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
          model: lastModel,
        }, { cause: err });
      }
      throw err;
    }
  }
}

const parseBatchRubric = (
  text: string,
  expectedLabels: ReadonlyMap<string, number>,
): z.infer<typeof batchRubricSchema> => {
  const match = extractJsonObject(text.trim());
  if (!match) {
    throw ValidationError("Batch judge returned no JSON object");
  }
  let json: unknown;
  try {
    json = JSON.parse(match);
  } catch {
    throw ValidationError("Batch judge returned malformed JSON");
  }
  const result = batchRubricSchema.safeParse(json);
  if (!result.success) {
    throw ValidationError("Batch judge output failed rubric validation", {
      issues: result.error.issues,
    });
  }
  const seen = new Set<string>();
  for (const entry of result.data.scores) {
    if (!expectedLabels.has(entry.label)) {
      throw ValidationError(
        `Batch judge produced unknown label "${entry.label}"`,
      );
    }
    if (seen.has(entry.label)) {
      throw ValidationError(
        `Batch judge produced duplicate label "${entry.label}"`,
      );
    }
    seen.add(entry.label);
  }
  if (seen.size !== expectedLabels.size) {
    const missing = [...expectedLabels.keys()].filter((label) => !seen.has(label));
    throw ValidationError(
      `Batch judge missing labels: ${missing.join(", ")}`,
    );
  }
  return result.data;
};
