import { z } from "zod";
import type { PromptVersionSummary } from "../../queries/prompt-query-service.js";
import type { TestGenerationMode } from "../../../domain/entities/benchmark.js";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import type { IAIProviderFactory } from "../ai-provider.js";
import { buildVersionGenerationSection } from "./evaluation-prompt.js";

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
// - hybrid: mix shared-core traffic with targeted difference-seeking probes.
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
  versionSpecs: readonly string[],
  mode: TestGenerationMode = "shared-core",
  seed?: number,
  taskType?: string,
): string => {
  if (versionSpecs.length === 0) {
    throw ValidationError("Test case generator needs at least one prompt version");
  }
  const taskHeader = taskType
    ? `Declared task type: ${taskType} — every test case input must be appropriate for this task.\n\n`
    : "";
  if (versionSpecs.length === 1) {
    return `${taskHeader}${versionSpecs[0] as string}`;
  }
  const order = seededShuffle(
    versionSpecs.map((_, i) => i),
    seed ?? 0,
  );
  const sections = order.map((originalIndex, position) => {
    const label = String.fromCharCode(65 + position);
    return `--- VERSION ${label} ---\n${versionSpecs[originalIndex]}`;
  });
  if (mode === "diff-seeking") {
    return [
      taskHeader +
        "The system under test has multiple prompt versions being benchmarked against each other. Generate test cases that expose differences between versions where possible: changed constraints, expanded capabilities, tighter refusals, edge cases, and regressions. Prefer realistic requests where at least one version is likely to behave materially differently from another.",
      "",
      sections.join("\n\n"),
    ].join("\n");
  }
  if (mode === "hybrid") {
    return [
      taskHeader +
        "The system under test has multiple prompt versions being benchmarked against each other. Generate a balanced benchmark mix: most cases should represent realistic shared traffic common to all versions, but include a meaningful minority of targeted probes that can expose behavioural differences, regressions, or changed constraints when those differences matter.",
      "Aim for roughly 70% shared-core coverage and 30% diff-seeking coverage. Do not turn the whole benchmark into edge-case hunting; preserve ordinary user traffic as the majority.",
      "",
      sections.join("\n\n"),
    ].join("\n");
  }
  return [
    taskHeader +
      "The system under test has multiple prompt versions being benchmarked against each other. Generate test cases that probe behaviour common to ALL versions (shared domain, shared constraints) — not the idiosyncrasies of any single version. If the versions disagree on a detail, target the overlap, not the difference.",
    "",
    sections.join("\n\n"),
  ].join("\n");
};

export const buildEvaluationSpecFromVersions = (
  versions: readonly PromptVersionSummary[],
  mode: TestGenerationMode = "shared-core",
  seed?: number,
  taskType?: string,
): string =>
  buildEvaluationSpec(
    versions.map(buildVersionGenerationSection),
    mode,
    seed,
    taskType,
  );

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

const extractJsonObject = (text: string): string | null => {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
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

const buildGenerationPrompt = (systemPrompt: string, count: number): string =>
  `You are a senior QA engineer designing a benchmark for the system specified below. You will write user-side inputs (the "user" turn) that genuinely probe how THIS system behaves — not generic prompts that any LLM could answer.

---
SYSTEM SPEC UNDER TEST:
"""
${systemPrompt}
"""
---

PHASE 1 — Read the spec carefully and answer silently (do NOT output any of this):
1. What concrete task does the system perform? Describe it in one sentence.
2. What inputs does a real user need to provide for the system to produce a useful answer? What format are those inputs in?
3. What constraints / guardrails / output format rules are stated or implied?
4. If a BRAID workflow graph is shown, the system follows it step by step at runtime — design inputs that exercise the actual decision branches in that graph, not unrelated topics.
5. If template variables ({{name}}) are listed, they are LITERAL placeholders the runtime substitutes server-side. Do NOT invent new {{...}} names. Either substitute a realistic concrete value matching the variable's description, or, when natural, keep the listed placeholder verbatim. Never reference variables not in the list.

If, after this analysis, the system's task is genuinely unclear (the spec is empty or contradictory), still produce ${count} cases that match the most plausible reading — but stay strictly inside that reading.

PHASE 2 — Generate exactly ${count} test cases tailored to this specific system.

Each test case must fall into one of these categories:
1. typical — Most common, representative request for this specific system.
2. complex — Multi-step or multi-constraint request that is hard but valid for this system.
3. ambiguous — Missing key information that this system specifically needs to answer correctly.
4. adversarial — Attempts to make THIS system violate ITS OWN stated instructions (prompt injection, role override, out-of-scope manipulation) — must reference real constraints in the spec, not generic jailbreaks.
5. edge_case — A boundary condition specific to this domain (extreme values, unusual format, language mismatch, or a topic that is almost but not quite in scope).
6. contradictory — A request whose internal contradictions are meaningful in THIS domain (not generic nonsense).
7. stress — Maximally demanding but still valid request for this system.

Target category mix (aim for this distribution, but prefer realism — it is fine
if one case lands in an adjacent category when the domain demands it):
${formatCategoryPlan(count)}

HARD RULES (a case that violates any of these is unacceptable; rewrite it):
- The "input" field is exactly what a real user of this system would send — written in the user's voice, no QA framing, no labels, no headers, no markdown fences, no JSON.
- Every input must require this system's specific task to be answered well; if a generic chatbot could answer it identically, it is too generic — replace it.
- Stay inside the system's declared scope. Do not ask the system to do tasks it was not built for unless the case is explicitly adversarial / edge_case AND the violation is the point.
- No meta commentary ("as a tester I would ask…", "test for…"), no category names, no rationale text inside the input.
- Adversarial cases must exploit a constraint that is actually stated in the spec. Generic prompt-injection ("ignore previous instructions") is only acceptable when paired with a domain-specific payload that targets a real rule in the spec.
- Variable handling: only reference placeholders from the listed variables (if any). Prefer realistic concrete values; only keep {{name}} verbatim when substituting would lose the structural intent of the test.
- Inputs must be coherent, complete, and self-contained — no "...", no truncated thoughts, no placeholder text like "[insert X]".
- Each case must be materially distinct from the others. No paraphrases of the same request.
- Return exactly ${count} cases. Tag each with whichever listed category best fits; never invent new category labels.

Respond with a JSON object in this exact format:
{
  "testCases": [
    { "input": "first user message here", "category": "typical" },
    { "input": "second user message here", "category": "adversarial" }
  ]
}

Use category values from this set only: typical, complex, ambiguous, adversarial, edge_case, contradictory, stress.

Return only the JSON object, no other text.`;

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
  if (count < TEST_CASE_CATEGORIES.length) {
    return [
      "- Small benchmark: prioritize realistic and representative traffic over full category spread.",
      "- Cover the most informative categories for this prompt; do not force one case per category.",
    ].join("\n");
  }
  const plan = buildCategoryPlan(count);
  return TEST_CASE_CATEGORIES.map((category) => {
    const target = plan.get(category) ?? 0;
    return `- ${category}: ${target}`;
  }).join("\n");
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
    const basePrompt = buildGenerationPrompt(systemPrompt, count);
    const baseMessages = [{ role: "user" as const, content: basePrompt }];

    const firstResponse = await provider.generate({
      model,
      messages: baseMessages,
      temperature: 0.8,
      ...(seed !== undefined ? { seed } : {}),
    });

    const firstParsed = tryParseTestCases(firstResponse.text);
    if (firstParsed.ok) {
      return finaliseTestCases(firstParsed.value, count);
    }

    // Retry once with the previous assistant turn echoed back so the model
    // sees exactly what failed and a strict correction instruction. We keep
    // temperature at 0 here because the retry is about format compliance,
    // not exploration.
    const retryResponse = await provider.generate({
      model,
      messages: [
        ...baseMessages,
        { role: "assistant", content: firstResponse.text },
        {
          role: "user",
          content:
            "Your previous response could not be parsed as valid JSON. " +
            `Respond again with ONLY the JSON object in the exact shape requested, containing exactly ${count} test cases. No markdown, no prose.`,
        },
      ],
      temperature: 0,
      ...(seed !== undefined ? { seed } : {}),
    });

    const retryParsed = tryParseTestCases(retryResponse.text);
    if (!retryParsed.ok) {
      throw retryParsed.error;
    }
    return finaliseTestCases(retryParsed.value, count);
  }
}

type RawTestCase = z.infer<typeof responseSchema>["testCases"][number];

type ParseResult =
  | { ok: true; value: RawTestCase[] }
  | { ok: false; error: Error };

const tryParseTestCases = (text: string): ParseResult => {
  const match = extractJsonObject(text.trim());
  if (!match) {
    return { ok: false, error: ValidationError("Test case generator returned no JSON object") };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match);
  } catch {
    return { ok: false, error: ValidationError("Test case generator returned malformed JSON") };
  }
  const result = responseSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: ValidationError("Test case generator output failed validation", {
        issues: result.error.issues,
      }),
    };
  }
  return { ok: true, value: result.data.testCases };
};

const normaliseForDedup = (input: string): string =>
  input.trim().toLowerCase().replace(/\s+/g, " ");

const finaliseTestCases = (
  raw: RawTestCase[],
  count: number,
): GeneratedTestCase[] => {
  const seen = new Set<string>();
  const unique: RawTestCase[] = [];
  for (const tc of raw) {
    const key = normaliseForDedup(tc.input);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(tc);
  }

  // ID allocation is the caller's responsibility (via IIdGenerator) — the
  // generator stays pure input/category. Keeps the domain aggregate the sole
  // owner of id-producing ports.
  const testCases = unique.slice(0, count).map((tc) => ({
    input: tc.input,
    category: tc.category,
  }));
  if (testCases.length !== count) {
    throw ValidationError(
      `Test case generator returned ${testCases.length} unique cases, expected ${count}`,
    );
  }
  return testCases;
};
