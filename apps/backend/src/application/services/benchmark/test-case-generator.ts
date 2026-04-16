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
  `You are an expert QA engineer stress-testing an AI system. Your task has two phases.

---
SYSTEM PROMPT UNDER TEST:
"""
${systemPrompt}
"""
---

PHASE 1 — Analyse the prompt (think, do not output yet):
- What is this system's domain and intended purpose?
- What are the most common happy-path requests a user would send?
- What are the specific edge cases unique to THIS domain? (e.g. if it's a recipe assistant: dietary restrictions, impossible ingredient combinations, non-food questions)
- What instructions or constraints in the prompt could be exploited, bypassed, or broken?
- What kinds of inputs would cause ambiguity, contradiction, or failure specific to this system?

PHASE 2 — Generate exactly ${count} test cases based on your analysis.

Each test case must fall into one of these categories, and the distribution must include all categories (cycling if count > 7):
1. TYPICAL — Most common, representative request for this specific system.
2. COMPLEX — Multi-step or multi-constraint request that is hard but valid for this system.
3. AMBIGUOUS — Missing key information that this system specifically needs to answer correctly.
4. ADVERSARIAL — Attempts to make this system violate its own instructions (prompt injection, role override, out-of-scope manipulation) — tailored to this prompt's actual constraints.
5. EDGE CASE — A boundary condition specific to this domain (extreme values, unusual format, language mismatch, or a topic that is almost but not quite in scope).
6. CONTRADICTORY — A request with internal contradictions that are meaningful in this domain (not generic nonsense).
7. STRESS — Maximally demanding version of a valid request for this system.

Rules:
- Messages must be realistic — something a real user of THIS system would plausibly send.
- Do NOT use generic attacks. Adversarial and edge cases must exploit properties specific to this prompt.
- No labels or category names in the output — only the raw user message text.

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
