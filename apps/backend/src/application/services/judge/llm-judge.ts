import { z } from "zod";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import { JudgeScore } from "../../../domain/value-objects/judge-score.js";
import { AIProviderError, type IAIProviderFactory } from "../ai-provider.js";
import {
  JudgeExecutionError,
  type IJudge,
  type JudgeInput,
  type JudgeResult,
} from "./judge.js";
import { buildJudgeMessages } from "./judge-prompt.js";
import { computeVerbosityPenalty } from "./verbosity-penalty.js";

export interface LLMJudgeConfig {
  judgeModel: string;
  temperature?: number;
}

const rubricSchema = z.object({
  accuracy: z.number().int().min(1).max(5),
  coherence: z.number().int().min(1).max(5),
  instruction: z.number().int().min(1).max(5),
  reasoning: z.string().min(1),
});

const JSON_OBJECT_REGEX = /\{[\s\S]*\}/;

export class LLMJudge implements IJudge {
  constructor(
    private readonly providers: IAIProviderFactory,
    private readonly config: LLMJudgeConfig,
  ) {}

  async grade(input: JudgeInput): Promise<JudgeResult> {
    const provider = this.providers.forModel(this.config.judgeModel);
    let response;
    try {
      response = await provider.generate({
        model: this.config.judgeModel,
        messages: buildJudgeMessages(input),
        temperature: this.config.temperature ?? 0,
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

    try {
      const parsed = parseRubric(response.text);
      const verbosityPenalty = computeVerbosityPenalty(input.candidate, input.reference);
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
        usage: {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
        },
        model: response.model,
      };
    } catch (err) {
      if (err instanceof Error) {
        throw new JudgeExecutionError(err.message, {
          usage: response.usage,
          model: response.model,
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
