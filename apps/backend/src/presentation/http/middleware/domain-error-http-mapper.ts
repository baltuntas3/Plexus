import type { DomainErrorCode } from "../../../domain/errors/domain-error.js";

// Single HTTP translation table for DomainError. Kept in the presentation
// layer so the domain stays transport-agnostic. Every DomainErrorCode must
// have an entry; the exhaustive switch means adding a new code without
// mapping it here fails the TypeScript build.
export const domainErrorCodeToHttpStatus = (code: DomainErrorCode): number => {
  switch (code) {
    case "VALIDATION_ERROR":
    case "PROMPT_SOURCE_EMPTY":
    case "PROMPT_VERSION_HAS_NO_BRAID":
    case "BENCHMARK_MATRIX_EMPTY":
    case "BENCHMARK_NO_JUDGES":
    case "BENCHMARK_INVALID_REPETITIONS":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
    case "PROMPT_NOT_OWNED":
    case "BENCHMARK_NOT_OWNED":
      return 403;
    case "NOT_FOUND":
    case "PROMPT_NOT_FOUND":
    case "PROMPT_VERSION_NOT_FOUND":
    case "BENCHMARK_NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "PROMPT_AGGREGATE_STALE":
    case "PROMPT_INVALID_VERSION_TRANSITION":
    case "BENCHMARK_AGGREGATE_STALE":
    case "BENCHMARK_ILLEGAL_TRANSITION":
    case "BENCHMARK_NOT_IN_DRAFT":
      return 409;
    case "INTERNAL":
      return 500;
  }
};
