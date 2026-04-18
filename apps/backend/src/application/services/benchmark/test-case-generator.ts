import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import type { TestGenerationMode } from "../../../domain/entities/benchmark.js";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import type { IAIProviderFactory } from "../ai-provider.js";
import { buildEvaluationPrompt } from "./evaluation-prompt.js";

// Generates varied, realistic test inputs for a given system prompt by asking
// an LLM to act as a "test case author". The generated inputs are raw user
// messages — the same strings that will be sent as the `user` turn when
// evaluating each prompt version.
//
// When a benchmark has multiple prompt versions, the generator receives a
// combined "evaluation spec" — every version's prompt concatenated — plus an
// explicit generation mode:
// - shared-core: probe behaviour common to all versions.
// - diff-seeking: prefer cases that expose behavioural differences.
// This keeps the generation policy explicit rather than baking one benchmark
// philosophy into the generator.
//
// Each generated case is tagged with a category (typical, adversarial, …) so
// downstream analysis can break results down by test-case category.
//
// A seed is passed through to the provider so the same (spec, count, model,
// seed) tuple produces stable test cases across runs. Providers that do not
// support seeded sampling (e.g. Anthropic) fall back to non-determinism and
// this module does not try to simulate determinism on top; in those cases,
// higher repetition counts are the mechanism that captures variance.

export const TEST_CASE_CATEGORIES = [
  "typical",
  "complex",
  "ambiguous",
  "adversarial",
  "edge_case",
  "contradictory",
  "stress",
] as const;
export type TestCaseCategory = (typeof TEST_CASE_CATEGORIES)[number];

export interface GeneratedTestCase {
  id: string;
  input: string;
  category: TestCaseCategory;
}

const responseSchema = z.object({
  testCases: z
    .array(
      z.object({
        input: z.string().min(1),
        category: z.enum(TEST_CASE_CATEGORIES),
      }),
    )
    .min(1),
});

// Label versions with generic anonymous tags (VERSION A/B/…) and shuffle their
// order before building the generator prompt so the generator cannot bias its
// output toward the "newest" or chronologically-last prompt in diff-seeking
// mode. `seed` makes the shuffle reproducible across runs of the same
// benchmark.
export const buildEvaluationSpec = (
  versionPrompts: readonly string[],
  mode: TestGenerationMode = "shared-core",
  seed?: number,
): string => {
  if (versionPrompts.length === 0) {
    throw ValidationError("Test case generator needs at least one prompt version");
  }
  if (versionPrompts.length === 1) {
    return versionPrompts[0] as string;
  }
  const order = seededShuffle(
    versionPrompts.map((_, i) => i),
    seed ?? 0,
  );
  const sections = order.map((originalIndex, position) => {
    const label = String.fromCharCode(65 + position);
    return `--- VERSION ${label} ---\n${versionPrompts[originalIndex]}`;
  });
  if (mode === "diff-seeking") {
    return [
      "The system under test has multiple prompt versions being benchmarked against each other. Generate test cases that expose differences between versions where possible: changed constraints, expanded capabilities, tighter refusals, edge cases, and regressions. Prefer realistic requests where at least one version is likely to behave materially differently from another.",
      "",
      sections.join("\n\n"),
    ].join("\n");
  }
  return [
    "The system under test has multiple prompt versions being benchmarked against each other. Generate test cases that probe behaviour common to ALL versions (shared domain, shared constraints) — not the idiosyncrasies of any single version. If the versions disagree on a detail, target the overlap, not the difference.",
    "",
    sections.join("\n\n"),
  ].join("\n");
};

export const buildEvaluationSpecFromVersions = (
  versions: readonly PromptVersion[],
  mode: TestGenerationMode = "shared-core",
  seed?: number,
): string => buildEvaluationSpec(versions.map(buildEvaluationPrompt), mode, seed);

const seededShuffle = <T>(items: readonly T[], seed: number): T[] => {
  const shuffled = [...items];
  let state = (seed >>> 0) || 1;
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const j = state % (i + 1);
    const tmp = shuffled[i] as T;
    shuffled[i] = shuffled[j] as T;
    shuffled[j] = tmp;
  }
  return shuffled;
};

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

Each test case must fall into one of these categories:
1. typical — Most common, representative request for this specific system.
2. complex — Multi-step or multi-constraint request that is hard but valid for this system.
3. ambiguous — Missing key information that this system specifically needs to answer correctly.
4. adversarial — Attempts to make this system violate its own instructions (prompt injection, role override, out-of-scope manipulation) — tailored to this prompt's actual constraints.
5. edge_case — A boundary condition specific to this domain (extreme values, unusual format, language mismatch, or a topic that is almost but not quite in scope).
6. contradictory — A request with internal contradictions that are meaningful in this domain (not generic nonsense).
7. stress — Maximally demanding version of a valid request for this system.

Required category counts:
${formatCategoryPlan(count)}

Rules:
- Messages must be realistic — something a real user of THIS system would plausibly send.
- Do NOT use generic attacks. Adversarial and edge cases must exploit properties specific to this prompt.
- The "input" field must be the raw user message only — no category label inside it.
- Match the required category counts exactly.

Respond with a JSON object in this exact format:
{
  "testCases": [
    { "input": "first user message here", "category": "typical" },
    { "input": "second user message here", "category": "adversarial" }
  ]
}

Use category values from this set only: typical, complex, ambiguous, adversarial, edge_case, contradictory, stress.

Return only the JSON object, no other text.`;

const validateCategoryCoverage = (
  testCases: readonly GeneratedTestCase[],
  count: number,
): void => {
  const expectedPlan = buildCategoryPlan(count);
  const actualCounts = countByCategory(testCases);
  const mismatches = TEST_CASE_CATEGORIES.filter(
    (category) => actualCounts.get(category) !== expectedPlan.get(category),
  ).map(
    (category) =>
      `${category}: expected ${expectedPlan.get(category) ?? 0}, got ${actualCounts.get(category) ?? 0}`,
  );
  if (mismatches.length > 0) {
    throw ValidationError(
      `Test case generator did not match required category distribution: ${mismatches.join("; ")}`,
    );
  }
};

const buildCategoryPlan = (count: number): Map<TestCaseCategory, number> => {
  const plan = new Map<TestCaseCategory, number>(
    TEST_CASE_CATEGORIES.map((category) => [category, 0]),
  );
  for (let index = 0; index < count; index += 1) {
    const category = TEST_CASE_CATEGORIES[index % TEST_CASE_CATEGORIES.length]!;
    plan.set(category, (plan.get(category) ?? 0) + 1);
  }
  return plan;
};

const formatCategoryPlan = (count: number): string => {
  const plan = buildCategoryPlan(count);
  return TEST_CASE_CATEGORIES.map((category) => {
    const target = plan.get(category) ?? 0;
    return `- ${category}: ${target}`;
  }).join("\n");
};

const countByCategory = (
  testCases: readonly GeneratedTestCase[],
): Map<TestCaseCategory, number> => {
  const counts = new Map<TestCaseCategory, number>(
    TEST_CASE_CATEGORIES.map((category) => [category, 0]),
  );
  for (const testCase of testCases) {
    counts.set(testCase.category, (counts.get(testCase.category) ?? 0) + 1);
  }
  return counts;
};

export class TestCaseGenerator {
  constructor(private readonly providers: IAIProviderFactory) {}

  async generate(
    systemPrompt: string,
    count: number,
    model: string,
    seed?: number,
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
      ...(seed !== undefined ? { seed } : {}),
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

    const testCases = result.data.testCases.slice(0, count).map((tc) => ({
      id: randomUUID(),
      input: tc.input,
      category: tc.category,
    }));
    if (testCases.length !== count) {
      throw ValidationError(
        `Test case generator returned ${testCases.length} cases, expected ${count}`,
      );
    }
    validateCategoryCoverage(testCases, count);
    return testCases;
  }
}
