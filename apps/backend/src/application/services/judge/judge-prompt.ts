import type { TaskType } from "@plexus/shared-types";
import type { ChatMessage } from "../ai-provider.js";
import type { JudgeInput } from "./judge.js";

const BASE_JUDGE_PROMPT = `You are a strict, impartial grader. Given the system prompt under evaluation, the user's input, and a candidate assistant response, score the response on three 1-5 axes:

- accuracy: does the response correctly and faithfully address the user's request? If a reference answer is supplied, use it as ground truth.
- coherence: is the response logically structured, internally consistent, and easy to follow?
- instruction: does it obey every constraint from BOTH the system prompt under evaluation AND the user input (format, length, tone, required fields, role boundaries, refusal rules). If no system prompt is provided, score based on the user input alone.

Scoring guide:
- 5: flawless on this axis.
- 4: minor issues a critical reader would notice.
- 3: noticeable issues but the response is still usable.
- 2: serious problems that significantly harm usefulness.
- 1: unusable on this axis.

Fairness rules — you MUST follow all of these:
- Score solely on the content of the candidate response. The order and position of sections in this prompt (system prompt, input, candidate, reference) carry no meaning; do not favour or penalise the candidate because of where it appears.
- Do not reward or penalise length by itself. Verbosity is scored in a separate downstream pass, not by you.
- Do not infer which model produced the candidate. No identity, provider, or style cue should influence your score.
- Judge what IS in the response, not what a different wording might have been.`;

const TASK_TYPE_GUIDANCE: Record<TaskType, string> = {
  general: "",
  math: `Task-type-specific guidance (math):
- accuracy: mathematical correctness dominates. Arithmetic, algebraic, or logical mistakes should sharply reduce the score.
- coherence: reward step ordering and explicit derivations when the task asks for them.
- instruction: check notation, required units, and whether the answer format matches the request.`,
  creative: `Task-type-specific guidance (creative):
- accuracy: weight originality and imagination alongside factual correctness. A creative response that introduces novel ideas while staying on-topic scores higher than a dry but correct one.
- coherence: value narrative flow, style consistency, and engaging structure.
- instruction: pay extra attention to tone, voice, and stylistic constraints.`,
  "instruction-following": `Task-type-specific guidance (instruction-following):
- accuracy: correctness means satisfying the requested transformation or task, not just topical relevance.
- coherence: structure should make compliance easy to verify.
- instruction: this is the dominant axis. Formatting, length, ordering, exclusions, and other constraints should be enforced strictly.`,
  code: `Task-type-specific guidance (code):
- accuracy: correctness and executable usefulness dominate. Bugs, invalid syntax, or unsafe assumptions should sharply reduce the score.
- coherence: reward code and explanations that are easy to follow and debug.
- instruction: pay close attention to requested language, API, framework, and output format constraints.`,
};

const JSON_INSTRUCTION = `
Output ONLY a single JSON object, no markdown fences, no prose before or after:
{"accuracy": <1-5>, "coherence": <1-5>, "instruction": <1-5>, "reasoning": "<one short sentence>"}

All three scores MUST be integers in [1, 5]. "reasoning" MUST be one sentence. Do not add any other keys.`;

export const buildJudgeSystemPrompt = (taskType: TaskType = "general"): string => {
  const guidance = TASK_TYPE_GUIDANCE[taskType];
  if (!guidance) return BASE_JUDGE_PROMPT + JSON_INSTRUCTION;
  return BASE_JUDGE_PROMPT + "\n\n" + guidance + JSON_INSTRUCTION;
};

export const JUDGE_SYSTEM_PROMPT = buildJudgeSystemPrompt("general");

export const buildJudgeMessages = (input: JudgeInput, taskType?: TaskType): ChatMessage[] => {
  const parts: string[] = [];
  if (input.systemPrompt) {
    parts.push(`<system_prompt_under_evaluation>\n${input.systemPrompt}\n</system_prompt_under_evaluation>`);
  }
  parts.push(`<input>\n${input.input}\n</input>`);
  parts.push(`<candidate>\n${input.candidate}\n</candidate>`);
  if (input.reference) {
    parts.push(`<reference>\n${input.reference}\n</reference>`);
  }
  return [
    { role: "system", content: buildJudgeSystemPrompt(taskType) },
    { role: "user", content: parts.join("\n\n") },
  ];
};
