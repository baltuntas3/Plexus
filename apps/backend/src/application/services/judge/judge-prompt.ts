import type { TaskType } from "@plexus/shared-types";
import type { ChatMessage } from "../ai-provider.js";
import { seededShuffle } from "../../utils/seeded-shuffle.js";
import type { BatchJudgeInput } from "./judge.js";

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
- Do not reward or penalise length on the accuracy or coherence axes. If the system prompt or user input states an explicit length / format constraint (e.g. "respond in one sentence", "max 100 words", "JSON only"), score adherence to it on the instruction axis. If no length constraint is stated, do not punish a response for being long or short — judge what IS in the response.
- Do not infer which model produced the candidate. No identity, provider, or style cue should influence your score.
- Judge what IS in the response, not what a different wording might have been.
- The system prompt is shown only so you can verify the candidate respects its constraints. Its length, register, level of detail, or stylistic choices MUST NOT bias your accuracy or coherence scores — those two axes evaluate the candidate's content on its own. Only the instruction axis weighs how well the candidate adheres to the system prompt's stated rules.`;

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

// Batch judge prompt — N attempts of the SAME prompt × input combination,
// presented with shuffled anonymous labels (ATTEMPT_<n>) so the judge cannot
// anchor on order or on which attempt was first/last. The judge is
// instructed explicitly to score each attempt independently, NOT to compare
// them to each other (since these are repetitions of the same system, not
// rivals). Output is a JSON object whose `scores` array is keyed by label,
// so we can match results back to the original input order even if the model
// reorders or drops entries.
const BATCH_JUDGE_INSTRUCTIONS = `
You are evaluating multiple separate ATTEMPTS at the same task — different runs of the same system on the same input. Each attempt is a fully independent response.

Independence rules — you MUST follow all of these:
- Score each attempt on its own merits, exactly as you would if you saw it alone. Do NOT compare attempts to each other.
- The order of attempts in this prompt is randomised; position carries no meaning. Do not favour the first or the last attempt.
- An attempt does NOT become better or worse because the others happen to be similar, different, longer, or shorter.
- Identical attempts must receive identical scores.

Output ONLY a single JSON object matching this exact shape, no markdown fences, no prose:
{"scores": [{"label": "ATTEMPT_1", "accuracy": <1-5>, "coherence": <1-5>, "instruction": <1-5>, "reasoning": "<one short sentence>"}, ...]}

Include one entry per labelled attempt below; reuse the labels exactly. All three rubric scores MUST be integers in [1, 5]. "reasoning" MUST be one sentence.`;

export const buildBatchJudgeSystemPrompt = (taskType: TaskType = "general"): string => {
  const guidance = TASK_TYPE_GUIDANCE[taskType];
  if (!guidance) return BASE_JUDGE_PROMPT + BATCH_JUDGE_INSTRUCTIONS;
  return BASE_JUDGE_PROMPT + "\n\n" + guidance + BATCH_JUDGE_INSTRUCTIONS;
};

export interface BuiltBatchJudgePrompt {
  messages: ChatMessage[];
  // Maps the label string ("ATTEMPT_<n>") to the original candidate index in
  // BatchJudgeInput.candidates. The caller uses this to reorder parsed
  // scores back to input order.
  labelToOriginalIndex: Map<string, number>;
}

export const buildBatchJudgeMessages = (
  input: BatchJudgeInput,
  taskType?: TaskType,
): BuiltBatchJudgePrompt => {
  const order = seededShuffle(
    input.candidates.map((_, i) => i),
    input.seed ?? 0,
  );
  const labelToOriginalIndex = new Map<string, number>();
  const lines: string[] = [];
  if (input.systemPrompt) {
    lines.push(
      `<system_prompt_under_evaluation>\n${input.systemPrompt}\n</system_prompt_under_evaluation>`,
    );
  }
  lines.push(`<input>\n${input.input}\n</input>`);
  if (input.reference) {
    lines.push(`<reference>\n${input.reference}\n</reference>`);
  }
  order.forEach((originalIndex, position) => {
    const label = `ATTEMPT_${position + 1}`;
    labelToOriginalIndex.set(label, originalIndex);
    const candidate = input.candidates[originalIndex] ?? "";
    lines.push(`<attempt label="${label}">\n${candidate}\n</attempt>`);
  });
  return {
    messages: [
      { role: "system", content: buildBatchJudgeSystemPrompt(taskType) },
      { role: "user", content: lines.join("\n\n") },
    ],
    labelToOriginalIndex,
  };
};
