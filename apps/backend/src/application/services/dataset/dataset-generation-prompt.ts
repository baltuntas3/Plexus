import type { TaskType } from "@plexus/shared-types";
import type { ChatMessage } from "../ai-provider.js";

const TASK_INSTRUCTIONS: Record<TaskType, string> = {
  math: "Each test case must be a self-contained math problem. The expectedOutput must be the exact numerical answer (e.g. \"42\" or \"3.14\"). Do not include units or explanation in expectedOutput.",
  general: "Each test case must be a question or instruction. The expectedOutput should be a concise correct answer.",
  creative: "Each test case must be a creative writing prompt. Set expectedOutput to null — creative outputs have no single correct answer.",
  "instruction-following": "Each test case must be a precise instruction to follow. The expectedOutput must be the exact expected result of following that instruction.",
  code: "Each test case must be a coding problem description. The expectedOutput must be the expected output when the solution is run, or null if the problem requires open-ended code.",
};

export const buildDatasetGenerationMessages = (
  taskType: TaskType,
  topic: string,
  count: number,
): ChatMessage[] => {
  const taskInstruction = TASK_INSTRUCTIONS[taskType];

  return [
    {
      role: "system",
      content: `You are a dataset generator for AI benchmarking. You generate diverse, high-quality test cases in JSON format.
Rules:
- Return ONLY a valid JSON array. No explanation, no markdown, no commentary.
- Each element: { "input": string, "expectedOutput": string | null }
- ${taskInstruction}
- Vary difficulty: mix easy, medium, and hard cases.
- Each input must be unique and unambiguous.`,
    },
    {
      role: "user",
      content: `Generate exactly ${count} test cases for task type "${taskType}" on the topic: "${topic}".`,
    },
  ];
};
