export type DomainErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "INTERNAL"
  | "PROMPT_NOT_FOUND"
  | "PROMPT_VERSION_NOT_FOUND"
  | "PROMPT_FORBIDDEN"
  | "PROMPT_AGGREGATE_STALE"
  | "PROMPT_SOURCE_EMPTY"
  | "PROMPT_BRAID_GENERATOR_MODEL_REQUIRED"
  | "PROMPT_VERSION_HAS_NO_BRAID"
  | "PROMPT_VERSION_HAS_NO_BRAID_TO_UPDATE";

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

export const PromptForbiddenError = (): DomainError =>
  new DomainError("PROMPT_FORBIDDEN", "You don't own this prompt", 403);

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

export const PromptBraidGeneratorModelRequiredError = (): DomainError =>
  new DomainError(
    "PROMPT_BRAID_GENERATOR_MODEL_REQUIRED",
    "generatorModel is required when setting a BRAID graph",
    400,
  );

export const PromptVersionHasNoBraidError = (): DomainError =>
  new DomainError(
    "PROMPT_VERSION_HAS_NO_BRAID",
    "Version has no BRAID graph to lint. Generate one first.",
    400,
  );

export const PromptVersionHasNoBraidToUpdateError = (): DomainError =>
  new DomainError(
    "PROMPT_VERSION_HAS_NO_BRAID_TO_UPDATE",
    "Version has no BRAID graph to update",
    400,
  );
