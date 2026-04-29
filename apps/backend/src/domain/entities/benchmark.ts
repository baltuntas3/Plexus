import type { TaskType } from "@plexus/shared-types";
import {
  BenchmarkIllegalTransitionError,
  BenchmarkInvalidRepetitionsError,
  BenchmarkMatrixEmptyError,
  BenchmarkNoJudgesError,
  BenchmarkNotInDraftError,
} from "../errors/domain-error.js";
import { BudgetUsd } from "../value-objects/budget-usd.js";
import { SolverTemperature } from "../value-objects/solver-temperature.js";
import { BenchmarkSeed } from "../value-objects/benchmark-seed.js";
import type { BenchmarkCostForecast } from "../value-objects/benchmark-cost-forecast.js";

// Benchmark aggregate.
//
// Owns the full run configuration (versions, solvers, judges, seed, budget,
// testCases) and encapsulates its lifecycle state machine. All mutations go
// through explicit domain methods: creation, draft-only test-case editing,
// queue, start, progress ticks, and the three terminal transitions
// (completeNormally / completeWithBudgetCap / failWith).
//
// TestCases are a child collection managed only via `editDraftTestCases` so
// the "only mutable while draft" invariant lives with the aggregate instead
// of being duplicated across use cases. Cost forecasts are reset whenever
// the matrix changes, via `refreshCostForecast`.
//
// Persistence follows the same snapshot/commit protocol as the Prompt
// aggregate: `toSnapshot()` takes a one-shot save token, the repository
// performs an optimistic-concurrency write gated on `expectedRevision`, and
// on success calls `commit(snapshot)` to advance the in-memory revision.

export type BenchmarkStatus =
  | "draft"
  | "queued"
  | "running"
  | "completed"
  | "completed_with_budget_cap"
  | "failed";

export interface BenchmarkProgress {
  completed: number;
  total: number;
}

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

export type TestCaseSource = "generated" | "manual";
export type TestGenerationMode = "shared-core" | "diff-seeking" | "hybrid";

export interface BenchmarkTestCase {
  id: string;
  input: string;
  expectedOutput: string | null;
  category: TestCaseCategory | null;
  source: TestCaseSource;
}

export interface BenchmarkPrimitives {
  id: string;
  name: string;
  // Owning organization. Read/write paths filter by this; benchmarks
  // never cross org boundaries.
  organizationId: string;
  // The user who created this benchmark — audit trail only.
  creatorId: string;
  promptVersionIds: string[];
  solverModels: string[];
  judgeModels: string[];
  generatorModel: string;
  testGenerationMode: TestGenerationMode;
  analysisModel: string | null;
  taskType: TaskType;
  costForecast: BenchmarkCostForecast | null;
  testCount: number;
  repetitions: number;
  solverTemperature: number;
  seed: number;
  concurrency: number;
  cellTimeoutMs: number | null;
  budgetUsd: number | null;
  status: BenchmarkStatus;
  progress: BenchmarkProgress;
  testCases: BenchmarkTestCase[];
  jobId: string | null;
  error: string | null;
  // Aggregate revision last seen in the store. Hydrated from persistence,
  // checked during save, advanced by `commit` on success.
  revision: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

// Snapshot the aggregate hands to the repository at save time. Mirrors the
// shape used by Prompt/PromptVersion/Organization aggregates so all
// repositories speak the same protocol — `primitives.revision` is the
// post-write value; `expectedRevision` is the WHERE-clause guard.
export interface BenchmarkSnapshot {
  readonly primitives: BenchmarkPrimitives;
  readonly expectedRevision: number;
}

export interface CreateBenchmarkParams {
  id: string;
  name: string;
  organizationId: string;
  creatorId: string;
  promptVersionIds: string[];
  solverModels: string[];
  judgeModels: string[];
  generatorModel: string;
  testGenerationMode: TestGenerationMode;
  analysisModel: string | null;
  taskType: TaskType;
  costForecast: BenchmarkCostForecast | null;
  testCount: number;
  repetitions: number;
  solverTemperature: number;
  seed: number;
  concurrency: number;
  cellTimeoutMs: number | null;
  budgetUsd: number | null;
  testCases: BenchmarkTestCase[];
  createdAt?: Date;
}

export interface EditDraftTestCasesParams {
  updates: ReadonlyArray<{
    id: string;
    input?: string;
    expectedOutput: string | null;
    category?: TestCaseCategory | null;
  }>;
  additions: ReadonlyArray<{
    id: string;
    input: string;
    expectedOutput: string | null;
    category: TestCaseCategory | null;
  }>;
}

export class Benchmark {
  private constructor(private state: BenchmarkPrimitives) {}

  static create(params: CreateBenchmarkParams): Benchmark {
    // Run the VOs for their side-effect: they throw on invalid input and
    // keep the creation boundary consistent without us having to rewrite
    // the same check in every caller.
    SolverTemperature.of(params.solverTemperature);
    BenchmarkSeed.of(params.seed);
    if (params.budgetUsd !== null) {
      BudgetUsd.of(params.budgetUsd);
    }
    if (params.repetitions < 1) {
      throw BenchmarkInvalidRepetitionsError();
    }
    if (params.judgeModels.length === 0) {
      throw BenchmarkNoJudgesError();
    }
    const now = params.createdAt ?? new Date();
    return new Benchmark({
      id: params.id,
      name: params.name,
      organizationId: params.organizationId,
      creatorId: params.creatorId,
      promptVersionIds: [...params.promptVersionIds],
      solverModels: [...params.solverModels],
      judgeModels: [...params.judgeModels],
      generatorModel: params.generatorModel,
      testGenerationMode: params.testGenerationMode,
      analysisModel: params.analysisModel,
      taskType: params.taskType,
      costForecast: params.costForecast,
      testCount: params.testCount,
      repetitions: params.repetitions,
      solverTemperature: params.solverTemperature,
      seed: params.seed,
      concurrency: params.concurrency,
      cellTimeoutMs: params.cellTimeoutMs,
      budgetUsd: params.budgetUsd,
      status: "draft",
      progress: { completed: 0, total: 0 },
      testCases: params.testCases.map((tc) => ({ ...tc })),
      jobId: null,
      error: null,
      revision: 0,
      createdAt: now,
      startedAt: null,
      completedAt: null,
    });
  }

  static hydrate(primitives: BenchmarkPrimitives): Benchmark {
    return new Benchmark({
      ...primitives,
      promptVersionIds: [...primitives.promptVersionIds],
      solverModels: [...primitives.solverModels],
      judgeModels: [...primitives.judgeModels],
      testCases: primitives.testCases.map((tc) => ({ ...tc })),
      progress: { ...primitives.progress },
    });
  }

  // ── Read accessors ───────────────────────────────────────────────────────

  get id(): string {
    return this.state.id;
  }
  get name(): string {
    return this.state.name;
  }
  get organizationId(): string {
    return this.state.organizationId;
  }
  get creatorId(): string {
    return this.state.creatorId;
  }
  get promptVersionIds(): readonly string[] {
    return [...this.state.promptVersionIds];
  }
  get solverModels(): readonly string[] {
    return [...this.state.solverModels];
  }
  get judgeModels(): readonly string[] {
    return [...this.state.judgeModels];
  }
  get generatorModel(): string {
    return this.state.generatorModel;
  }
  get testGenerationMode(): TestGenerationMode {
    return this.state.testGenerationMode;
  }
  get analysisModel(): string | null {
    return this.state.analysisModel;
  }
  get taskType(): TaskType {
    return this.state.taskType;
  }
  get costForecast(): BenchmarkCostForecast | null {
    return this.state.costForecast;
  }
  get testCount(): number {
    return this.state.testCount;
  }
  get repetitions(): number {
    return this.state.repetitions;
  }
  get solverTemperature(): number {
    return this.state.solverTemperature;
  }
  get seed(): number {
    return this.state.seed;
  }
  get concurrency(): number {
    return this.state.concurrency;
  }
  get cellTimeoutMs(): number | null {
    return this.state.cellTimeoutMs;
  }
  get budgetUsd(): number | null {
    return this.state.budgetUsd;
  }
  get status(): BenchmarkStatus {
    return this.state.status;
  }
  get progress(): BenchmarkProgress {
    return { ...this.state.progress };
  }
  // Defensive copy: `readonly` is shallow in TS so returning the live array
  // would still let a caller `push` into aggregate state.
  get testCases(): readonly BenchmarkTestCase[] {
    return this.state.testCases.map((tc) => ({ ...tc }));
  }
  get jobId(): string | null {
    return this.state.jobId;
  }
  get error(): string | null {
    return this.state.error;
  }
  get revision(): number {
    return this.state.revision;
  }
  get createdAt(): Date {
    return this.state.createdAt;
  }
  get startedAt(): Date | null {
    return this.state.startedAt;
  }
  get completedAt(): Date | null {
    return this.state.completedAt;
  }

  // ── Draft-only edits ─────────────────────────────────────────────────────

  editDraftTestCases(params: EditDraftTestCasesParams): BenchmarkTestCase[] {
    if (this.state.status !== "draft") {
      throw BenchmarkNotInDraftError();
    }
    const updated = this.state.testCases.map((tc) => {
      const update = params.updates.find((u) => u.id === tc.id);
      if (!update) return tc;
      return {
        ...tc,
        input: update.input ?? tc.input,
        expectedOutput: update.expectedOutput,
        category:
          update.category !== undefined ? update.category : tc.category,
      };
    });
    const appended: BenchmarkTestCase[] = params.additions.map((a) => ({
      id: a.id,
      input: a.input,
      expectedOutput: a.expectedOutput,
      category: a.category,
      source: "manual",
    }));
    this.state = {
      ...this.state,
      testCases: [...updated, ...appended],
    };
    return appended;
  }

  refreshCostForecast(forecast: BenchmarkCostForecast): void {
    this.state = { ...this.state, costForecast: forecast };
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  queue(): void {
    if (this.state.status === "queued" || this.state.status === "running") {
      throw BenchmarkIllegalTransitionError(this.state.status, "queued");
    }
    this.state = {
      ...this.state,
      status: "queued",
      error: null,
    };
  }

  // Starts execution. Accepts `draft` too so a test or admin path can hand
  // a benchmark straight to the runner without a separate enqueue step —
  // the production flow still goes draft→queued→running.
  start(jobId: string, startedAt: Date = new Date()): void {
    if (
      this.state.status !== "queued" &&
      this.state.status !== "draft" &&
      this.state.status !== "running"
    ) {
      throw BenchmarkIllegalTransitionError(this.state.status, "running");
    }
    this.state = {
      ...this.state,
      status: "running",
      jobId,
      startedAt: this.state.startedAt ?? startedAt,
      error: null,
    };
  }

  recordProgress(completed: number, total: number): void {
    if (this.state.status !== "running") {
      throw BenchmarkIllegalTransitionError(this.state.status, "progress");
    }
    this.state = {
      ...this.state,
      progress: { completed, total },
    };
  }

  completeNormally(completedAt: Date = new Date()): void {
    if (this.state.status !== "running") {
      throw BenchmarkIllegalTransitionError(this.state.status, "completed");
    }
    this.state = {
      ...this.state,
      status: "completed",
      completedAt,
      error: null,
    };
  }

  completeWithBudgetCap(reason: string, completedAt: Date = new Date()): void {
    if (this.state.status !== "running") {
      throw BenchmarkIllegalTransitionError(
        this.state.status,
        "completed_with_budget_cap",
      );
    }
    this.state = {
      ...this.state,
      status: "completed_with_budget_cap",
      completedAt,
      error: reason,
    };
  }

  // Failure is accepted from any non-terminal state — a crash can happen
  // mid-queue or mid-run, and the aggregate still needs a way to record it.
  failWith(message: string, completedAt: Date = new Date()): void {
    this.state = {
      ...this.state,
      status: "failed",
      completedAt,
      error: message,
    };
  }

  // ── Runnability invariants ───────────────────────────────────────────────
  //
  // Runners call this before building a matrix so the "empty", "no judges",
  // "invalid repetitions" preconditions surface as typed domain errors
  // instead of ad-hoc validation strings scattered across services.
  assertRunnable(): void {
    if (this.state.testCases.length === 0) {
      throw BenchmarkMatrixEmptyError();
    }
    if (this.state.judgeModels.length === 0) {
      throw BenchmarkNoJudgesError();
    }
    if (this.state.repetitions < 1) {
      throw BenchmarkInvalidRepetitionsError();
    }
  }

  // ── Snapshot / markPersisted ─────────────────────────────────────────────

  toSnapshot(): BenchmarkSnapshot {
    const expectedRevision = this.state.revision;
    return {
      primitives: { ...this.state, revision: expectedRevision + 1 },
      expectedRevision,
    };
  }

  markPersisted(): void {
    this.state = { ...this.state, revision: this.state.revision + 1 };
  }
}
