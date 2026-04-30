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
    case "PROMPT_INVALID_VERSION_TRANSITION":
    case "BENCHMARK_MATRIX_EMPTY":
    case "BENCHMARK_NO_JUDGES":
    case "BENCHMARK_INVALID_REPETITIONS":
    case "ORGANIZATION_OWNER_INVARIANT":
    case "ORGANIZATION_LAST_OWNER":
    case "ORGANIZATION_INVITATION_NOT_ACTIVE":
    case "ORGANIZATION_INVITATION_EXPIRED":
    case "ORGANIZATION_INVITATION_EMAIL_MISMATCH":
    case "VERSION_APPROVAL_REQUEST_NOT_ACTIVE":
    case "VERSION_APPROVAL_REQUEST_DUPLICATE_VOTE":
    case "VERSION_APPROVAL_REQUEST_SELF_APPROVAL":
    case "VERSION_APPROVAL_REQUIRED":
    case "VERSION_APPROVAL_NOT_ENABLED":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
    case "PROMPT_NOT_OWNED":
    case "BENCHMARK_NOT_OWNED":
    case "ORGANIZATION_MEMBERSHIP_REQUIRED":
      return 403;
    case "NOT_FOUND":
    case "PROMPT_NOT_FOUND":
    case "PROMPT_VERSION_NOT_FOUND":
    case "BENCHMARK_NOT_FOUND":
    case "ORGANIZATION_NOT_FOUND":
    case "ORGANIZATION_MEMBER_NOT_FOUND":
    case "ORGANIZATION_INVITATION_NOT_FOUND":
    case "VERSION_APPROVAL_REQUEST_NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "PROMPT_AGGREGATE_STALE":
    case "PROMPT_VERSION_AGGREGATE_STALE":
    case "BENCHMARK_AGGREGATE_STALE":
    case "BENCHMARK_ILLEGAL_TRANSITION":
    case "BENCHMARK_NOT_IN_DRAFT":
    case "ORGANIZATION_AGGREGATE_STALE":
    case "ORGANIZATION_MEMBER_AGGREGATE_STALE":
    case "ORGANIZATION_SLUG_TAKEN":
    case "ORGANIZATION_INVITATION_AGGREGATE_STALE":
    case "ORGANIZATION_INVITATION_ALREADY_PENDING":
    case "VERSION_APPROVAL_REQUEST_AGGREGATE_STALE":
    case "VERSION_APPROVAL_REQUEST_ALREADY_PENDING":
      return 409;
    case "INTERNAL":
      return 500;
  }
};
