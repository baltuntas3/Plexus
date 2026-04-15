import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import type { IAIProviderFactory } from "../ai-provider.js";

// Generates varied, realistic test inputs for a given system prompt by asking
// an LLM to act as a "test case author". The generated inputs are raw user
// messages — the same strings that will be sent as the `user` turn when
// evaluating each prompt version.

export interface GeneratedTestCase {
  id: string;
  input: string;
}

const responseSchema = z.object({
  testCases: z.array(z.string().min(1)).min(1),
});

const JSON_OBJECT_REGEX = /\{[\s\S]*\}/;

const buildGenerationPrompt = (systemPrompt: string, count: number): string =>
  `You are a thorough QA engineer creating test inputs for an AI system.

Given the following system prompt, generate exactly ${count} diverse and realistic user messages that would be sent to this system. The inputs should:
- Cover different use cases, phrasings, and edge cases
- Vary in complexity and length
- Include both simple and challenging scenarios
- Be realistic messages a real user would send

System prompt to test:
"""
${systemPrompt}
"""

Respond with a JSON object in this exact format:
{
  "testCases": [
    "first user message here",
    "second user message here"
  ]
}

Return only the JSON object, no other text.`;

export class TestCaseGenerator {
  constructor(private readonly providers: IAIProviderFactory) {}

  async generate(
    systemPrompt: string,
    count: number,
    model: string,
  ): Promise<GeneratedTestCase[]> {
    const provider = this.providers.forModel(model);
    const response = await provider.generate({
      model,
      messages: [
        {
          role: "user",
          content: buildGenerationPrompt(systemPrompt, count),
        },
      ],
      temperature: 0.8,
    });

    const match = JSON_OBJECT_REGEX.exec(response.text.trim());
    if (!match) {
      throw ValidationError("Test case generator returned no JSON object");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      throw ValidationError("Test case generator returned malformed JSON");
    }

    const result = responseSchema.safeParse(parsed);
    if (!result.success) {
      throw ValidationError("Test case generator output failed validation", {
        issues: result.error.issues,
      });
    }

    return result.data.testCases.slice(0, count).map((input) => ({
      id: randomUUID(),
      input,
    }));
  }
}
