import { z } from "zod";
import {
  TEST_CASE_CATEGORIES,
  type TestCaseCategory,
} from "@plexus/shared-types";
import type { PromptVersionSummary } from "../../queries/prompt-query-service.js";
import type { TestGenerationMode } from "../../../domain/entities/benchmark.js";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import { extractJsonObject } from "../../utils/extract-json-object.js";
import { seededShuffle } from "../../utils/seeded-shuffle.js";
import type { IAIProviderFactory } from "../ai-provider.js";
import { TEMPLATE_VARIABLE_PLACEHOLDER_RULE_FULL } from "../template-variables-prompt.js";
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

interface GeneratedTestCase {
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
const buildEvaluationSpec = (
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
2. INTERACTION MODE — pick exactly ONE:
   (A) CONVERSATIONAL: the user TALKS to the system — questions, requests, chat. Inputs are user utterances.
   (B) ARTIFACT-PROCESSOR: the user FEEDS RAW DATA (a customer review, email, log line, code snippet, document, transcript, support ticket, etc.) and the system analyzes / classifies / extracts / transforms / scores / summarizes it. Inputs ARE the artifact itself.

   How to tell:
   - Phrases like "analyze X", "score X", "classify X", "summarize X", "extract from X", "given X produce Y", "the input is a [noun]", or any noun like "ham yorum / raw review / metin / text / belge / document / kod / code" being described as the input → MODE B.
   - Phrases like "answer questions about", "help with", "respond to", "have a conversation" → MODE A.
   - Default to MODE A only if the spec is genuinely ambiguous AND no artifact noun is named.
3. (Mode A) What does a typical user message look like?
   (Mode B) What is the artifact's natural form — length, language, tone, structure?
4. What constraints / guardrails / output format rules are stated or implied?
5. If a BRAID workflow graph is shown, the system follows it step by step at runtime — design inputs that exercise the actual decision branches in that graph, not unrelated topics.
6. ${TEMPLATE_VARIABLE_PLACEHOLDER_RULE_FULL}

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
- The "input" field is the raw user-side payload for the interaction mode you picked in PHASE 1, and ONLY that. In MODE A it is the user's message in their natural voice; in MODE B it is the raw artifact alone (no QA framing, no preamble like "analyze this:" / "şunu puanla:" / "score this review:"). Generic example for a Mode B customer-satisfaction analyzer:
    – WRONG: "Şu yorumu 5 üzerinden puanla: 'Ürün iyi.'"
    – RIGHT: "Ürün gayet iyi ama kargo geç geldi, biraz hayal kırıklığı yaşadım."
- Every input must require this system's specific task to be answered well; a generic chatbot prompt is unacceptable.
- Stay inside the system's declared scope. Out-of-scope requests are only allowed when the violation IS the point (adversarial / edge_case).
- No meta commentary, category names, or rationale text inside the "input" field.
- Adversarial cases exploit a constraint actually stated in the spec; for Mode B, adversarial inputs are artifacts whose own contents carry the prompt-injection payload, not meta-questions about the system.
- Inputs must be coherent, complete, and self-contained — no "...", no "[insert X]" placeholders.
- Cases must be materially distinct from each other, and exactly ${count} of them. Use only the listed category labels.

Respond with a JSON object in this exact format. The "input" string is the
raw user message (Mode A) or raw artifact (Mode B) — nothing else:
{
  "testCases": [
    { "input": "<raw user message OR raw artifact>", "category": "typical" },
    { "input": "<raw user message OR raw artifact>", "category": "adversarial" }
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

export const generateTestCases = async (
  providers: IAIProviderFactory,
  systemPrompt: string,
  count: number,
  model: string,
  seed?: number,
): Promise<GeneratedTestCase[]> => {
  const provider = providers.forModel(model);
  const basePrompt = buildGenerationPrompt(systemPrompt, count);
  const baseMessages: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: basePrompt },
  ];

  const firstResponse = await provider.generate({
    model,
    messages: baseMessages,
    temperature: 0.8,
    responseFormat: "json",
    ...(seed !== undefined ? { seed } : {}),
  });

  const firstParsed = tryParseTestCases(firstResponse.text);
  if (firstParsed.ok) {
    return finaliseTestCases(firstParsed.value, count);
  }

  // Retry strategy is keyed to the failure mode rather than blindly rerolling:
  // - "format" (no JSON object / malformed JSON despite responseFormat: "json")
  //   is sampling noise. T=0 collapses the variance and almost always recovers
  //   without needing the bad assistant turn echoed back; that would roughly
  //   double input tokens for no information gain since `responseFormat: "json"`
  //   makes T=0 reliably emit valid JSON.
  // - "schema" (parse succeeded, structure violated the rubric — wrong count,
  //   wrong category, missing fields) means the model misread the contract.
  //   T=0 alone would just re-emit the same misread; the model needs to *see*
  //   what it got wrong. We append the bad output and the validation issues
  //   as a follow-up turn so the next attempt grounds against concrete
  //   problems instead of sampling blindly.
  const retryMessages: Array<{ role: "user" | "assistant"; content: string }> =
    firstParsed.kind === "schema"
      ? [
          ...baseMessages,
          { role: "assistant", content: firstResponse.text },
          {
            role: "user",
            content: buildSchemaRetryPrompt(firstParsed.issues, count),
          },
        ]
      : baseMessages;

  const retryResponse = await provider.generate({
    model,
    messages: retryMessages,
    temperature: 0,
    responseFormat: "json",
    ...(seed !== undefined ? { seed } : {}),
  });

  const retryParsed = tryParseTestCases(retryResponse.text);
  if (!retryParsed.ok) {
    throw retryParsed.error;
  }
  return finaliseTestCases(retryParsed.value, count);
};

type RawTestCase = z.infer<typeof responseSchema>["testCases"][number];

type ParseResult =
  | { ok: true; value: RawTestCase[] }
  | { ok: false; kind: "format"; error: Error }
  | { ok: false; kind: "schema"; error: Error; issues: z.ZodIssue[] };

const tryParseTestCases = (text: string): ParseResult => {
  const match = extractJsonObject(text.trim());
  if (!match) {
    return {
      ok: false,
      kind: "format",
      error: ValidationError("Test case generator returned no JSON object"),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match);
  } catch {
    return {
      ok: false,
      kind: "format",
      error: ValidationError("Test case generator returned malformed JSON"),
    };
  }
  const result = responseSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      kind: "schema",
      issues: result.error.issues,
      error: ValidationError("Test case generator output failed validation", {
        issues: result.error.issues,
      }),
    };
  }
  return { ok: true, value: result.data.testCases };
};

const buildSchemaRetryPrompt = (
  issues: readonly z.ZodIssue[],
  count: number,
): string => {
  const formattedIssues = issues
    .map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  return [
    "Your previous response parsed as JSON but did not match the required schema. Fix the listed issues and resend the FULL test case set.",
    "",
    "Validation issues:",
    formattedIssues,
    "",
    `Required: a JSON object {"testCases": [...]} with exactly ${count} entries; each entry must have a non-empty "input" string and a "category" from the allowed enum (typical, complex, ambiguous, adversarial, edge_case, contradictory, stress).`,
    "",
    "Return ONLY the corrected JSON object. No prose, no explanation.",
  ].join("\n");
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
