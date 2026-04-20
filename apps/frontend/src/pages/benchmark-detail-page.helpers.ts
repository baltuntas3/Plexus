import type {
  BenchmarkDetailDto,
  BenchmarkResultDto,
  BenchmarkTestCaseDto,
  TestCaseCategory,
} from "@plexus/shared-types";
import { TEST_CASE_CATEGORIES } from "@plexus/shared-types";

export interface DraftBenchmarkEdits {
  inputEdits: Record<string, string>;
  expectedOutputs: Record<string, string>;
  categoryEdits: Record<string, TestCaseCategory | null>;
}

export interface NewCaseDraft {
  localId: string;
  input: string;
  expectedOutput: string;
  category: TestCaseCategory | "";
}

export interface AggregateRow {
  key: string;
  label: string;
  versionId: string;
  versionLabel: string;
  solverModel: string;
  finalScore: number;
  accuracyAllRuns: number;
  costUsd: number;
  totalRuns: number;
  failedRuns: number;
  failureRate: number;
  operationalIssueWeight: number;
  operationalIssueRate: number;
}

const operationalIssueWeight = (result: BenchmarkResultDto): number => {
  if (result.status === "failed") {
    return result.failureKind === "budget_exceeded" ? 0 : 1;
  }
  const totalJudges = result.judgeVotes.length + result.judgeFailureCount;
  if (totalJudges <= 0) return 0;
  return result.judgeFailureCount / totalJudges;
};

export const CATEGORY_OPTIONS = [
  { value: "", label: "Uncategorized" },
  ...TEST_CASE_CATEGORIES.map((category) => ({
    value: category,
    label: category.replace("_", " "),
  })),
];

export const buildDraftBenchmarkEdits = (
  testCases: readonly BenchmarkTestCaseDto[],
): DraftBenchmarkEdits => {
  const inputEdits: Record<string, string> = {};
  const expectedOutputs: Record<string, string> = {};
  const categoryEdits: Record<string, TestCaseCategory | null> = {};

  for (const testCase of testCases) {
    inputEdits[testCase.id] = testCase.input;
    if (testCase.expectedOutput) {
      expectedOutputs[testCase.id] = testCase.expectedOutput;
    }
    categoryEdits[testCase.id] = testCase.category;
  }

  return { inputEdits, expectedOutputs, categoryEdits };
};

export const createEmptyNewCase = (): NewCaseDraft => ({
  localId: crypto.randomUUID(),
  input: "",
  expectedOutput: "",
  category: "",
});

export const buildTestCaseUpdatePayload = (
  benchmark: BenchmarkDetailDto,
  edits: DraftBenchmarkEdits,
  newCases: readonly NewCaseDraft[],
) => ({
  updates: benchmark.testCases.map((testCase) => ({
    id: testCase.id,
    input:
      edits.inputEdits[testCase.id] !== testCase.input
        ? edits.inputEdits[testCase.id]
        : undefined,
    expectedOutput: edits.expectedOutputs[testCase.id] ?? null,
    category: edits.categoryEdits[testCase.id] ?? null,
  })),
  additions: newCases.map((testCase) => ({
    input: testCase.input,
    expectedOutput: testCase.expectedOutput || null,
    category: testCase.category || null,
  })),
});

export const buildResultsByCase = (
  results: readonly BenchmarkResultDto[],
): Map<string, BenchmarkResultDto[]> => {
  const grouped = new Map<string, BenchmarkResultDto[]>();
  for (const result of results) {
    const rows = grouped.get(result.testCaseId) ?? [];
    rows.push(result);
    grouped.set(result.testCaseId, rows);
  }
  return grouped;
};

export const aggregateBenchmarkResults = (
  results: readonly BenchmarkResultDto[],
  versionLabels: Record<string, string>,
): AggregateRow[] => {
  const rows = new Map<string, AggregateRow>();
  for (const result of results) {
    const key = `${result.promptVersionId}::${result.solverModel}`;
    const versionLabel =
      versionLabels[result.promptVersionId] ?? result.promptVersionId.slice(-6);
    const existing = rows.get(key);
    if (existing) {
      existing.finalScore += result.status === "completed" ? result.finalScore : 0;
      existing.accuracyAllRuns += result.status === "completed" ? result.judgeAccuracy : 0;
      existing.costUsd += result.totalCostUsd;
      existing.totalRuns += 1;
      if (result.status === "failed") existing.failedRuns += 1;
      existing.operationalIssueWeight += operationalIssueWeight(result);
      continue;
    }

    rows.set(key, {
      key,
      label: `${versionLabel} · ${result.solverModel}`,
      versionId: result.promptVersionId,
      versionLabel,
      solverModel: result.solverModel,
      finalScore: result.status === "completed" ? result.finalScore : 0,
      accuracyAllRuns: result.status === "completed" ? result.judgeAccuracy : 0,
      costUsd: result.totalCostUsd,
      totalRuns: 1,
      failedRuns: result.status === "failed" ? 1 : 0,
      failureRate: result.status === "failed" ? 1 : 0,
      operationalIssueWeight: operationalIssueWeight(result),
      operationalIssueRate: 0,
    });
  }

  for (const row of rows.values()) {
    const completedRuns = row.totalRuns - row.failedRuns;
    row.finalScore = completedRuns <= 0 ? 0 : row.finalScore / completedRuns;
    row.accuracyAllRuns = completedRuns <= 0 ? 0 : row.accuracyAllRuns / completedRuns;
    row.failureRate = row.totalRuns === 0 ? 0 : row.failedRuns / row.totalRuns;
    row.operationalIssueRate =
      row.totalRuns === 0 ? 0 : row.operationalIssueWeight / row.totalRuns;
  }

  return [...rows.values()].sort((a, b) => b.finalScore - a.finalScore);
};
