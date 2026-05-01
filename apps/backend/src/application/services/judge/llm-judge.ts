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
import { computeVerbosityPenalty } from "./verbosity-penalty.js";

export interface LLMJudgeConfig {
  judgeModel: string;
  temperature?: number;
  taskType?: TaskType;
}

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
        temperature: this.config.temperature ?? 0,
        seed: input.seed,
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

    // Malformed-JSON retry: judges occasionally wrap the object in prose or
    // markdown fences even with the explicit instruction. One additional
    // attempt with a strict reminder recovers those rows cheaply; after that
    // we surface the usage from both attempts so partial cost is preserved.
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
          messages: [
            ...messages,
            { role: "assistant", content: response.text },
            {
              role: "user",
              content:
                "Your previous response was not valid JSON. Respond with ONLY the JSON object specified — no markdown fences, no prose.",
            },
          ],
          temperature: 0,
          seed: input.seed,
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
      const verbosityPenalty = computeVerbosityPenalty(
        input.candidate,
        input.reference,
      );
      const score = JudgeScore.fromRubric(
        {
          accuracy: parsed.accuracy,
          coherence: parsed.coherence,
          instruction: parsed.instruction,
        },
        verbosityPenalty,
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
    // Single-candidate batches degenerate to single grade — same call shape
    // and same prompt form, so callers don't need a length-1 special case.
    if (input.candidates.length === 1) {
      const single = await this.grade({
        input: input.input,
        candidate: input.candidates[0] as string,
        seed: input.seed,
        reference: input.reference,
        systemPrompt: input.systemPrompt,
      });
      return { scores: [single.score], usage: single.usage, model: single.model };
    }

    const provider = this.providers.forModel(this.config.judgeModel);
    const built = buildBatchJudgeMessages(input, this.config.taskType);
    let response;
    try {
      response = await provider.generate({
        model: this.config.judgeModel,
        messages: built.messages,
        temperature: this.config.temperature ?? 0,
        seed: input.seed,
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
        const retry = await provider.generate({
          model: this.config.judgeModel,
          messages: [
            ...built.messages,
            { role: "assistant", content: response.text },
            {
              role: "user",
              content:
                "Your previous response was not valid JSON or did not match the required shape. " +
                `Respond again with ONLY the JSON object {"scores": [...]} containing exactly ${input.candidates.length} entries — one per ATTEMPT label, reusing the labels exactly. No markdown, no prose.`,
            },
          ],
          temperature: 0,
          seed: input.seed,
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
        const candidate = input.candidates[originalIndex] as string;
        const verbosityPenalty = computeVerbosityPenalty(candidate, input.reference);
        orderedScores[originalIndex] = JudgeScore.fromRubric(
          {
            accuracy: entry.accuracy,
            coherence: entry.coherence,
            instruction: entry.instruction,
          },
          verbosityPenalty,
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
