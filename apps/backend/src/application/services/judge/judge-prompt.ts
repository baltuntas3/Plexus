import type { ChatMessage } from "../ai-provider.js";
import type { JudgeInput } from "./judge.js";

export const JUDGE_SYSTEM_PROMPT = `You are a strict, impartial grader. Given the system prompt under evaluation, the user's input, and a candidate assistant response, score the response on three 1-5 axes:

- accuracy: does the response correctly and faithfully address the user's request? If a reference answer is supplied, use it as ground truth.
- coherence: is the response logically structured, internally consistent, and easy to follow?
- instruction: does it obey every constraint from BOTH the system prompt under evaluation AND the user input (format, length, tone, required fields, role boundaries, refusal rules). If no system prompt is provided, score based on the user input alone.

Scoring guide:
- 5: flawless on this axis.
- 4: minor issues a critical reader would notice.
- 3: noticeable issues but the response is still usable.
- 2: serious problems that significantly harm usefulness.
- 1: unusable on this axis.

Output ONLY a single JSON object, no markdown fences, no prose before or after:
{"accuracy": <1-5>, "coherence": <1-5>, "instruction": <1-5>, "reasoning": "<one short sentence>"}

All three scores MUST be integers in [1, 5]. "reasoning" MUST be one sentence. Do not add any other keys.`;

export const buildJudgeMessages = (input: JudgeInput): ChatMessage[] => {
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
    { role: "system", content: JUDGE_SYSTEM_PROMPT },
    { role: "user", content: parts.join("\n\n") },
  ];
};
