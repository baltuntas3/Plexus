export type DomainErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "INTERNAL";

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
