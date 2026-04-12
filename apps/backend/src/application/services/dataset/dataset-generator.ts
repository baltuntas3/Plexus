import type { TaskType } from "@plexus/shared-types";
import type { IAIProviderFactory, TokenUsage } from "../ai-provider.js";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import { buildDatasetGenerationMessages } from "./dataset-generation-prompt.js";

export interface GeneratedTestCase {
  input: string;
  expectedOutput: string | null;
}

export interface DatasetGenerationInput {
  taskType: TaskType;
  topic: string;
  count: number;
  model: string;
}

export interface DatasetGenerationResult {
  testCases: GeneratedTestCase[];
  model: string;
  usage: TokenUsage;
}

export class DatasetGenerator {
  constructor(private readonly providers: IAIProviderFactory) {}

  async generate(input: DatasetGenerationInput): Promise<DatasetGenerationResult> {
    const messages = buildDatasetGenerationMessages(input.taskType, input.topic, input.count);
    const provider = this.providers.forModel(input.model);

    const response = await provider.generate({
      model: input.model,
      messages,
      temperature: 0.7,
    });

    const testCases = parseTestCases(response.text, input.count);

    return { testCases, model: response.model, usage: response.usage };
  }
}

const JSON_ARRAY_REGEX = /\[[\s\S]*\]/;

const parseTestCases = (text: string, expectedCount: number): GeneratedTestCase[] => {
  const match = JSON_ARRAY_REGEX.exec(text.trim());
  if (!match) {
    throw ValidationError("Dataset generator returned invalid JSON: no array found");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw ValidationError("Dataset generator returned malformed JSON");
  }

  if (!Array.isArray(parsed)) {
    throw ValidationError("Dataset generator did not return a JSON array");
  }

  const testCases: GeneratedTestCase[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i] as Record<string, unknown>;
    if (typeof item !== "object" || item === null) {
      throw ValidationError(`Test case at index ${i} is not an object`);
    }
    if (typeof item["input"] !== "string" || item["input"].trim().length === 0) {
      throw ValidationError(`Test case at index ${i} is missing a valid "input" field`);
    }
    const expectedOutput =
      item["expectedOutput"] === null || item["expectedOutput"] === undefined
        ? null
        : String(item["expectedOutput"]);

    testCases.push({ input: item["input"].trim(), expectedOutput });
  }

  if (testCases.length === 0) {
    throw ValidationError("Dataset generator returned zero test cases");
  }

  if (testCases.length < expectedCount) {
    // Partial results are still usable — caller decides whether to retry.
  }

  return testCases;
};
