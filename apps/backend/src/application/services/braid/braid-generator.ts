import { createHash } from "node:crypto";
import type { TaskType } from "@plexus/shared-types";
import { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import { TokenCost } from "../../../domain/value-objects/token-cost.js";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import {
  GraphQualityScore,
  type RuleResult,
} from "../../../domain/value-objects/graph-quality-score.js";
import type { IAIProviderFactory, TokenUsage } from "../ai-provider.js";
import { calculateCost } from "../model-registry.js";
import type { ICacheStore } from "../cache-store.js";
import type { GraphLinter } from "./lint/graph-linter.js";
import {
  ENHANCED_SYSTEM_PROMPT,
  MERMAID_OUTPUT_CONTRACT,
} from "./enhanced-generation-prompt.js";
import { buildDetailedBraidRulesPrompt } from "./braid-rules-prompt.js";

interface BraidGenerationInput {
  sourcePrompt: string;
  taskType: TaskType;
  generatorModel: string;
  forceRegenerate?: boolean;
}

interface BraidGenerationResult {
  graph: BraidGraph;
  generatorModel: string;
  usage: TokenUsage;
  cost: TokenCost;
  cached: boolean;
  qualityScore: GraphQualityScore;
}

// Persisted alongside the mermaid so the cache-hit path returns the same
// quality score the generator computed during validation, with no extra
// lint pass on retrieval. Storing the full RuleResult[] (not just issues)
// preserves per-rule scores and display names, so the rebuilt score is
// byte-identical to the original.
interface CachedEntry {
  mermaidCode: string;
  usage: TokenUsage;
  qualityRuleResults: RuleResult[];
}

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

// Bump whenever the generation or repair prompt changes so stale cache
// entries generated with older templates are not reused.
const PROMPT_TEMPLATE_VERSION = "v6-shared-rules-repair";

const GENERATION_TEMPERATURE = 0;
// Single repair attempt: the validator is deterministic and additional turns
// rarely succeed where the first repair did not. The repair turn receives
// the full rule book (REPAIR_SYSTEM_PROMPT) so the model is never asked to
// fix a graph against criteria it can no longer see.
const MAX_REPAIR_ATTEMPTS = 1;

const REPAIR_SYSTEM_PROMPT = `You are an expert BRAID graph designer fixing a Mermaid flowchart that failed validation. Apply the listed validation failures while keeping every other aspect of the graph intact.

${buildDetailedBraidRulesPrompt()}

${MERMAID_OUTPUT_CONTRACT}`;

export class BraidGenerator {
  constructor(
    private readonly providers: IAIProviderFactory,
    private readonly cache: ICacheStore,
    private readonly linter: GraphLinter,
  ) {}

  async generate(input: BraidGenerationInput): Promise<BraidGenerationResult> {
    const key = this.cacheKey(input);

    if (!input.forceRegenerate) {
      const hit = await this.cache.get<CachedEntry>(key);
      if (hit) {
        const graph = BraidGraph.parse(hit.mermaidCode);
        const qualityScore = GraphQualityScore.fromRuleResults(hit.qualityRuleResults);
        return this.buildResult(graph, input.generatorModel, hit.usage, true, qualityScore);
      }
    }

    const generated = await this.generateAndRepair(input);

    await this.cache.set<CachedEntry>(
      key,
      {
        mermaidCode: generated.graph.mermaidCode,
        usage: generated.usage,
        qualityRuleResults: generated.qualityScore.results,
      },
      CACHE_TTL_SECONDS,
    );

    return this.buildResult(
      generated.graph,
      input.generatorModel,
      generated.usage,
      false,
      generated.qualityScore,
    );
  }

  private async generateAndRepair(input: BraidGenerationInput): Promise<{
    graph: BraidGraph;
    usage: TokenUsage;
    qualityScore: GraphQualityScore;
  }> {
    const provider = this.providers.forModel(input.generatorModel);
    const first = await provider.generate({
      model: input.generatorModel,
      temperature: GENERATION_TEMPERATURE,
      messages: [
        { role: "system", content: ENHANCED_SYSTEM_PROMPT },
        { role: "user", content: buildGenerationUserPrompt(input) },
      ],
    });

    let usage = { ...first.usage };
    let validation = this.validateGraph(first.text);
    if (validation.ok) {
      return { graph: validation.graph, usage, qualityScore: validation.qualityScore };
    }

    let currentText = first.text;
    for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt += 1) {
      const repaired = await provider.generate({
        model: input.generatorModel,
        temperature: GENERATION_TEMPERATURE,
        messages: [
          { role: "system", content: REPAIR_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildRepairPrompt(input, currentText, validation.diagnostics),
          },
        ],
      });
      usage = addUsage(usage, repaired.usage);
      currentText = repaired.text;
      validation = this.validateGraph(currentText);
      if (validation.ok) {
        return { graph: validation.graph, usage, qualityScore: validation.qualityScore };
      }
    }

    throw ValidationError(
      `BRAID generation failed validation after repair: ${validation.diagnostics.join("; ")}`,
    );
  }

  private validateGraph(text: string):
    | { ok: true; graph: BraidGraph; qualityScore: GraphQualityScore }
    | { ok: false; diagnostics: string[] } {
    let graph: BraidGraph;
    try {
      graph = BraidGraph.parse(cleanMermaidCode(text));
    } catch (err) {
      return {
        ok: false,
        diagnostics: [
          err instanceof Error ? err.message : String(err),
        ],
      };
    }

    const qualityScore = this.linter.lint(graph);
    const diagnostics = lintDiagnostics(qualityScore);
    if (diagnostics.length > 0) {
      return { ok: false, diagnostics };
    }
    return { ok: true, graph, qualityScore };
  }

  private buildResult(
    graph: BraidGraph,
    generatorModel: string,
    usage: TokenUsage,
    cached: boolean,
    qualityScore: GraphQualityScore,
  ): BraidGenerationResult {
    const cost = calculateCost(generatorModel, usage.inputTokens, usage.outputTokens);
    return { graph, generatorModel, usage, cost, cached, qualityScore };
  }

  private cacheKey(input: BraidGenerationInput): string {
    const hash = createHash("sha256");
    hash.update(input.sourcePrompt);
    hash.update("|");
    hash.update(input.taskType);
    hash.update("|");
    hash.update(input.generatorModel);
    hash.update("|");
    hash.update(PROMPT_TEMPLATE_VERSION);
    return `braid:${hash.digest("hex")}`;
  }
}

const cleanMermaidCode = (text: string): string => {
  const fenced = /```(?:mermaid)?\s*([\s\S]*?)```/i.exec(text.trim());
  return (fenced?.[1]?.trim() ?? text.trim()).replace(/^```.*$/gm, "").trim();
};

const buildGenerationUserPrompt = (input: BraidGenerationInput): string =>
  [
    `Task type: ${input.taskType}`,
    "",
    "Classical prompt to convert into BRAID:",
    "---",
    input.sourcePrompt,
    "---",
  ].join("\n");

const buildRepairPrompt = (
  input: BraidGenerationInput,
  mermaidCode: string,
  diagnostics: readonly string[],
): string =>
  [
    `Task type: ${input.taskType}`,
    "",
    "Original classical prompt:",
    "---",
    input.sourcePrompt,
    "---",
    "",
    "Current Mermaid graph:",
    "```mermaid",
    cleanMermaidCode(mermaidCode),
    "```",
    "",
    "Validation failures to fix:",
    ...diagnostics.map((diagnostic) => `- ${diagnostic}`),
    "",
    "Return only the corrected Mermaid graph.",
  ].join("\n");

const lintDiagnostics = (quality: GraphQualityScore): string[] =>
  quality.issues.map((issue) => {
    const target = issue.nodeId
      ? `node ${issue.nodeId}`
      : issue.edgeKey
        ? `edge ${issue.edgeKey}`
        : "graph";
    return `[${issue.severity}] ${issue.ruleId} on ${target}: ${issue.message}`;
  });

const addUsage = (left: TokenUsage, right: TokenUsage): TokenUsage => ({
  inputTokens: left.inputTokens + right.inputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
});
