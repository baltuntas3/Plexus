export type DomainErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "INTERNAL"
  | "PROMPT_NOT_FOUND"
  | "PROMPT_VERSION_NOT_FOUND"
  | "PROMPT_NOT_OWNED"
  | "PROMPT_AGGREGATE_STALE"
  | "PROMPT_SOURCE_EMPTY"
  | "PROMPT_VERSION_HAS_NO_BRAID"
  | "PROMPT_INVALID_VERSION_TRANSITION"
  | "BENCHMARK_NOT_FOUND"
  | "BENCHMARK_NOT_OWNED"
  | "BENCHMARK_AGGREGATE_STALE"
  | "BENCHMARK_ILLEGAL_TRANSITION"
  | "BENCHMARK_NOT_IN_DRAFT"
  | "BENCHMARK_MATRIX_EMPTY"
  | "BENCHMARK_NO_JUDGES"
  | "BENCHMARK_INVALID_REPETITIONS";

// Domain errors carry a stable `code` (ubiquitous language) and an optional
// `details` bag. Transport-specific mapping (HTTP status, gRPC code, i18n
// wording) lives in the presentation layer — see
// `presentation/http/errors/domain-error-http-mapper.ts`. Keeping httpStatus
// out of the domain is what lets the same code base serve over multiple
// transports later without the domain having to pick a transport's dialect.
export class DomainError extends Error {
  public readonly code: DomainErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: DomainErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export const ValidationError = (message: string, details?: Record<string, unknown>): DomainError =>
  new DomainError("VALIDATION_ERROR", message, details);

export const NotFoundError = (message: string): DomainError =>
  new DomainError("NOT_FOUND", message);

export const UnauthorizedError = (message = "Unauthorized"): DomainError =>
  new DomainError("UNAUTHORIZED", message);

export const ForbiddenError = (message = "Forbidden"): DomainError =>
  new DomainError("FORBIDDEN", message);

export const ConflictError = (message: string): DomainError =>
  new DomainError("CONFLICT", message);

// Prompt bounded-context errors.
export const PromptNotFoundError = (): DomainError =>
  new DomainError("PROMPT_NOT_FOUND", "Prompt not found");

export const PromptVersionNotFoundError = (version?: string): DomainError =>
  new DomainError(
    "PROMPT_VERSION_NOT_FOUND",
    version ? `Prompt version ${version} not found` : "Prompt version not found",
    version ? { version } : undefined,
  );

// Kept for defense-in-depth. Production write paths now reject foreign
// prompts as "not found" at the repository boundary so existence does not
// leak via id enumeration; this error covers the path where an aggregate
// somehow arrives unscoped (direct test calls, future code paths).
export const PromptNotOwnedError = (): DomainError =>
  new DomainError("PROMPT_NOT_OWNED", "Caller does not own this prompt");

export const PromptAggregateStaleError = (): DomainError =>
  new DomainError(
    "PROMPT_AGGREGATE_STALE",
    "Prompt was modified by another writer; reload and retry",
  );

export const PromptSourceEmptyError = (): DomainError =>
  new DomainError("PROMPT_SOURCE_EMPTY", "Source prompt is empty");

export const PromptVersionHasNoBraidError = (): DomainError =>
  new DomainError(
    "PROMPT_VERSION_HAS_NO_BRAID",
    "Version has no BRAID graph to lint. Generate one first.",
  );

export const PromptInvalidVersionTransitionError = (
  from: string,
  to: string,
): DomainError =>
  new DomainError(
    "PROMPT_INVALID_VERSION_TRANSITION",
    `Cannot move version from ${from} to ${to}`,
    { from, to },
  );

// Benchmark bounded-context errors.
export const BenchmarkNotFoundError = (id?: string): DomainError =>
  new DomainError(
    "BENCHMARK_NOT_FOUND",
    id ? `Benchmark ${id} not found` : "Benchmark not found",
    id ? { id } : undefined,
  );

// See note on `PromptNotOwnedError` — kept for defense-in-depth after the
// write path unified missing+foreign as "not found".
export const BenchmarkNotOwnedError = (): DomainError =>
  new DomainError("BENCHMARK_NOT_OWNED", "Caller does not own this benchmark");

export const BenchmarkAggregateStaleError = (): DomainError =>
  new DomainError(
    "BENCHMARK_AGGREGATE_STALE",
    "Benchmark was modified by another writer; reload and retry",
  );

export const BenchmarkIllegalTransitionError = (
  from: string,
  to: string,
): DomainError =>
  new DomainError(
    "BENCHMARK_ILLEGAL_TRANSITION",
    `Cannot move benchmark from ${from} to ${to}`,
    { from, to },
  );

export const BenchmarkNotInDraftError = (): DomainError =>
  new DomainError(
    "BENCHMARK_NOT_IN_DRAFT",
    "Test cases can only be edited while the benchmark is in draft status",
  );

export const BenchmarkMatrixEmptyError = (): DomainError =>
  new DomainError("BENCHMARK_MATRIX_EMPTY", "Benchmark matrix is empty");

export const BenchmarkNoJudgesError = (): DomainError =>
  new DomainError("BENCHMARK_NO_JUDGES", "Benchmark has no judge models");

export const BenchmarkInvalidRepetitionsError = (): DomainError =>
  new DomainError(
    "BENCHMARK_INVALID_REPETITIONS",
    "Benchmark repetitions must be at least 1",
  );
