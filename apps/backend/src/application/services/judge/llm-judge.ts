import { z } from "zod";
import type { TaskType } from "@plexus/shared-types";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import { JudgeScore } from "../../../domain/value-objects/judge-score.js";
import { AIProviderError, type IAIProviderFactory } from "../ai-provider.js";
import {
  JudgeExecutionError,
  type BatchJudgeInput,
  type BatchJudgeResult,
  type IJudge,
  type JudgeInput,
  type JudgeResult,
} from "./judge.js";
import { buildBatchJudgeMessages, buildJudgeMessages } from "./judge-prompt.js";

export interface LLMJudgeConfig {
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
// - reproducibility (same benchmark twice → same scores)
// - stable bias measurements (judgeBias rows actually mean something)
// - honest pairwise CIs (pairwiseComparisons.isSignificant)
// - cluster bootstrap CI assumes within-batch correlation comes only
//   from the shared prompt; a stochastic judge would invalidate it.
//
// There is intentionally no caller surface to override this; if you
// ever want a stochastic judge, build it as a separate class so the
// policy stays explicit at the type level.
const JUDGE_TEMPERATURE = 0;

const rubricSchema = z.object({
  accuracy: z.number().int().min(1).max(5),
  coherence: z.number().int().min(1).max(5),
  instruction: z.number().int().min(1).max(5),
  reasoning: z.string().min(1),
});

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

const JSON_OBJECT_REGEX = /\{[\s\S]*?\}/;

export class LLMJudge implements IJudge {
  constructor(
    private readonly providers: IAIProviderFactory,
    private readonly config: LLMJudgeConfig,
  ) {}

  async grade(input: JudgeInput): Promise<JudgeResult> {
    const provider = this.providers.forModel(this.config.judgeModel);
    const messages = buildJudgeMessages(input, this.config.taskType);
    let response;
    try {
      response = await provider.generate({
        model: this.config.judgeModel,
        messages,
        temperature: JUDGE_TEMPERATURE,
        seed: input.seed,
        responseFormat: "json",
      });
    } catch (err) {
      if (err instanceof AIProviderError) {
        throw new JudgeExecutionError(err.message, {
          usage: err.partial?.usage,
          model: err.partial?.model ?? this.config.judgeModel,
        }, { cause: err });
      }
      throw err;
    }

    // Defensive retry: provider JSON mode normally guarantees parseable
    // output, but the rubric still has to clear zod's structural checks
    // (integer 1-5, non-empty reasoning). One additional attempt at T=0
    // recovers those rows cheaply. We reissue the same prompt rather
    // than echoing the bad response back — the messages array is large
    // (judge system prompt + eval system prompt + input + candidate +
    // optional reference), so resending it doubled input tokens for a
    // recovery that almost always works on a fresh deterministic try.
    let parsed: z.infer<typeof rubricSchema>;
    let totalInputTokens = response.usage.inputTokens;
    let totalOutputTokens = response.usage.outputTokens;
    let lastModel = response.model;
    try {
      parsed = parseRubric(response.text);
    } catch (firstErr) {
      try {
        const retry = await provider.generate({
          model: this.config.judgeModel,
          messages,
          temperature: JUDGE_TEMPERATURE,
          seed: input.seed,
          responseFormat: "json",
        });
        totalInputTokens += retry.usage.inputTokens;
        totalOutputTokens += retry.usage.outputTokens;
        lastModel = retry.model;
        parsed = parseRubric(retry.text);
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
      const score = JudgeScore.fromRubric(
        {
          accuracy: parsed.accuracy,
          coherence: parsed.coherence,
          instruction: parsed.instruction,
        },
        parsed.reasoning,
      );
      return {
        score,
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

  async gradeBatch(input: BatchJudgeInput): Promise<BatchJudgeResult> {
    if (input.candidates.length === 0) {
      throw ValidationError("gradeBatch requires at least one candidate");
    }
    // Always go through the batch prompt — even for length-1 inputs.
    // Falling back to single `grade()` here would judge that one row with
    // a different system prompt (BASE + JSON_INSTRUCTION) than its
    // siblings (BASE + BATCH_JUDGE_INSTRUCTIONS), which lets solver
    // reliability sneak into the score: a row whose triple-mates all
    // failed would be judged under a different methodology than rows
    // from a fully-successful triple. Length-1 batches still use the
    // batch path; the prompt is uniform across the benchmark.
    const provider = this.providers.forModel(this.config.judgeModel);
    const built = buildBatchJudgeMessages(input, this.config.taskType);
    let response;
    try {
      response = await provider.generate({
        model: this.config.judgeModel,
        messages: built.messages,
        temperature: JUDGE_TEMPERATURE,
        seed: input.seed,
        responseFormat: "json",
      });
    } catch (err) {
      if (err instanceof AIProviderError) {
        throw new JudgeExecutionError(err.message, {
          usage: err.partial?.usage,
          model: err.partial?.model ?? this.config.judgeModel,
        }, { cause: err });
      }
      throw err;
    }

    let parsed: z.infer<typeof batchRubricSchema>;
    let totalInputTokens = response.usage.inputTokens;
    let totalOutputTokens = response.usage.outputTokens;
    let lastModel = response.model;
    try {
      parsed = parseBatchRubric(response.text, built.labelToOriginalIndex);
    } catch (firstErr) {
      try {
        // Same retry shape as the single-grade path: reissue the same
        // batched prompt at T=0 instead of echoing the bad response
        // back. Batched prompts carry N candidate outputs in the user
        // message, so resending the conversation would roughly double
        // input tokens for what is usually a format-compliance recovery.
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
        orderedScores[originalIndex] = JudgeScore.fromRubric(
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

const parseRubric = (text: string): z.infer<typeof rubricSchema> => {
  const match = JSON_OBJECT_REGEX.exec(text.trim());
  if (!match) {
    throw ValidationError("Judge returned no JSON object");
  }
  let json: unknown;
  try {
    json = JSON.parse(match[0]);
  } catch {
    throw ValidationError("Judge returned malformed JSON");
  }
  const result = rubricSchema.safeParse(json);
  if (!result.success) {
    throw ValidationError("Judge output failed rubric validation", {
      issues: result.error.issues,
    });
  }
  return result.data;
};

// Depth-tracking extractor — the simple non-greedy regex above stops at the
// first `}`, which would clip the inner score object out of a batched
// response. Skipping content inside JSON strings keeps a `}` inside a
// reasoning sentence from prematurely closing the match.
const extractTopLevelJsonObject = (text: string): string | null => {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
};

const parseBatchRubric = (
  text: string,
  expectedLabels: ReadonlyMap<string, number>,
): z.infer<typeof batchRubricSchema> => {
  const match = extractTopLevelJsonObject(text.trim());
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
