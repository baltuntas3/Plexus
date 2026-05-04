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
// fall back to their own defaults when temperature is omitted, and those
// defaults are NOT zero (e.g. groq-provider.ts → 0.6, OpenAI → 1.0,
// Anthropic → 1.0). Dropping the field would silently flip judging to
// stochastic mode and break the rest of the analyzer.
//
// This is a fairness contract, not a knob:
// - reproducibility — the same benchmark rerun produces the same scores,
//   so persisted rows are stable across recomputed analyses.
// - cluster bootstrap CI (analyzer's clusterBootstrapCI) assumes within-
//   batch correlation comes only from the shared judge prompt; a
//   stochastic judge would inject an extra noise source and invalidate
//   the resampling distribution.
// - paired bootstrap tie-break in pickWithPairedSignificanceTieBreak
//   compares per-cell score differences; with a stochastic judge those
//   differences would partly reflect judge re-roll noise rather than
//   real solver gaps.
// - judgeAgreement diffs would conflate genuine rubric disagreement
//   with the same judge sampling differently from itself.
//
// There is intentionally no caller surface to override this; if you
// ever want a stochastic judge, build it as a separate class so the
// policy stays explicit at the type level.
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
      try {
        // One defensive retry at T=0. Batched prompts carry N candidate
        // outputs in the user message, so reissuing the same prompt is
        // far cheaper than echoing the bad response back for a recovery
        // that almost always works on a fresh deterministic try.
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
