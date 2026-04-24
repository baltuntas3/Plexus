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

export class DomainError extends Error {
  public readonly code: DomainErrorCode;
  public readonly httpStatus: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: DomainErrorCode,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export const ValidationError = (message: string, details?: Record<string, unknown>): DomainError =>
  new DomainError("VALIDATION_ERROR", message, 400, details);

export const NotFoundError = (message: string): DomainError =>
  new DomainError("NOT_FOUND", message, 404);

export const UnauthorizedError = (message = "Unauthorized"): DomainError =>
  new DomainError("UNAUTHORIZED", message, 401);

export const ForbiddenError = (message = "Forbidden"): DomainError =>
  new DomainError("FORBIDDEN", message, 403);

export const ConflictError = (message: string): DomainError =>
  new DomainError("CONFLICT", message, 409);

// Prompt bounded-context errors. Message stays inside the domain as a
// developer/fallback description, but callers should route on `code` so the
// presentation layer owns the user-facing wording (enabling i18n and
// stable API error codes).
export const PromptNotFoundError = (): DomainError =>
  new DomainError("PROMPT_NOT_FOUND", "Prompt not found", 404);

export const PromptVersionNotFoundError = (version?: string): DomainError =>
  new DomainError(
    "PROMPT_VERSION_NOT_FOUND",
    version ? `Prompt version ${version} not found` : "Prompt version not found",
    404,
    version ? { version } : undefined,
  );

// Raised when a caller is not the owner of the target Prompt aggregate. The
// domain does not know about HTTP; the presentation layer maps this to 403.
export const PromptNotOwnedError = (): DomainError =>
  new DomainError("PROMPT_NOT_OWNED", "Caller does not own this prompt", 403);

// Raised when an optimistic-concurrency check fails during save — another
// writer advanced the aggregate's revision while this instance was held.
export const PromptAggregateStaleError = (): DomainError =>
  new DomainError(
    "PROMPT_AGGREGATE_STALE",
    "Prompt was modified by another writer; reload and retry",
    409,
  );

export const PromptSourceEmptyError = (): DomainError =>
  new DomainError("PROMPT_SOURCE_EMPTY", "Source prompt is empty", 400);

export const PromptVersionHasNoBraidError = (): DomainError =>
  new DomainError(
    "PROMPT_VERSION_HAS_NO_BRAID",
    "Version has no BRAID graph to lint. Generate one first.",
    400,
  );

// Raised when a version lifecycle transition is not permitted (e.g. demoting
// back to draft). Carries the `from`/`to` pair in details so callers can
// route on the tuple rather than parse messages.
export const PromptInvalidVersionTransitionError = (
  from: string,
  to: string,
): DomainError =>
  new DomainError(
    "PROMPT_INVALID_VERSION_TRANSITION",
    `Cannot move version from ${from} to ${to}`,
    409,
    { from, to },
  );

// Benchmark bounded-context errors. Same convention as the Prompt errors —
// domain throws the typed code, presentation maps to HTTP.
export const BenchmarkNotFoundError = (id?: string): DomainError =>
  new DomainError(
    "BENCHMARK_NOT_FOUND",
    id ? `Benchmark ${id} not found` : "Benchmark not found",
    404,
    id ? { id } : undefined,
  );

export const BenchmarkNotOwnedError = (): DomainError =>
  new DomainError("BENCHMARK_NOT_OWNED", "Caller does not own this benchmark", 403);

export const BenchmarkAggregateStaleError = (): DomainError =>
  new DomainError(
    "BENCHMARK_AGGREGATE_STALE",
    "Benchmark was modified by another writer; reload and retry",
    409,
  );

export const BenchmarkIllegalTransitionError = (
  from: string,
  to: string,
): DomainError =>
  new DomainError(
    "BENCHMARK_ILLEGAL_TRANSITION",
    `Cannot move benchmark from ${from} to ${to}`,
    409,
    { from, to },
  );

export const BenchmarkNotInDraftError = (): DomainError =>
  new DomainError(
    "BENCHMARK_NOT_IN_DRAFT",
    "Test cases can only be edited while the benchmark is in draft status",
    409,
  );

export const BenchmarkMatrixEmptyError = (): DomainError =>
  new DomainError("BENCHMARK_MATRIX_EMPTY", "Benchmark matrix is empty", 400);

export const BenchmarkNoJudgesError = (): DomainError =>
  new DomainError("BENCHMARK_NO_JUDGES", "Benchmark has no judge models", 400);

export const BenchmarkInvalidRepetitionsError = (): DomainError =>
  new DomainError(
    "BENCHMARK_INVALID_REPETITIONS",
    "Benchmark repetitions must be at least 1",
    400,
  );
