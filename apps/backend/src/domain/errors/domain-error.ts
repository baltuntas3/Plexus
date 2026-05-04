export type DomainErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "INTERNAL"
  | "PROMPT_NOT_FOUND"
  | "PROMPT_VERSION_NOT_FOUND"
  | "PROMPT_AGGREGATE_STALE"
  | "PROMPT_VERSION_AGGREGATE_STALE"
  | "PROMPT_SOURCE_EMPTY"
  | "PROMPT_VERSION_HAS_NO_BRAID"
  | "PROMPT_INVALID_VERSION_TRANSITION"
  | "BENCHMARK_NOT_FOUND"
  | "BENCHMARK_AGGREGATE_STALE"
  | "BENCHMARK_ILLEGAL_TRANSITION"
  | "BENCHMARK_NOT_IN_DRAFT"
  | "BENCHMARK_MATRIX_EMPTY"
  | "BENCHMARK_NO_JUDGES"
  | "BENCHMARK_INVALID_REPETITIONS"
  | "ORGANIZATION_NOT_FOUND"
  | "ORGANIZATION_SLUG_TAKEN"
  | "ORGANIZATION_AGGREGATE_STALE"
  | "ORGANIZATION_MEMBER_NOT_FOUND"
  | "ORGANIZATION_MEMBER_AGGREGATE_STALE"
  | "ORGANIZATION_MEMBERSHIP_REQUIRED"
  | "ORGANIZATION_OWNER_INVARIANT"
  | "ORGANIZATION_INVITATION_NOT_FOUND"
  | "ORGANIZATION_INVITATION_NOT_ACTIVE"
  | "ORGANIZATION_INVITATION_EXPIRED"
  | "ORGANIZATION_INVITATION_AGGREGATE_STALE"
  | "ORGANIZATION_INVITATION_EMAIL_MISMATCH"
  | "ORGANIZATION_INVITATION_ALREADY_PENDING"
  | "ORGANIZATION_LAST_OWNER"
  | "VERSION_APPROVAL_REQUEST_NOT_FOUND"
  | "VERSION_APPROVAL_REQUEST_NOT_ACTIVE"
  | "VERSION_APPROVAL_REQUEST_DUPLICATE_VOTE"
  | "VERSION_APPROVAL_REQUEST_SELF_APPROVAL"
  | "VERSION_APPROVAL_REQUEST_AGGREGATE_STALE"
  | "VERSION_APPROVAL_REQUEST_ALREADY_PENDING"
  | "VERSION_APPROVAL_REQUIRED"
  | "VERSION_APPROVAL_NOT_ENABLED";

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

export const PromptAggregateStaleError = (): DomainError =>
  new DomainError(
    "PROMPT_AGGREGATE_STALE",
    "Prompt was modified by another writer; reload and retry",
  );

export const PromptVersionAggregateStaleError = (): DomainError =>
  new DomainError(
    "PROMPT_VERSION_AGGREGATE_STALE",
    "Prompt version was modified by another writer; reload and retry",
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

// Organization bounded-context errors.
export const OrganizationNotFoundError = (): DomainError =>
  new DomainError("ORGANIZATION_NOT_FOUND", "Organization not found");

export const OrganizationSlugTakenError = (slug: string): DomainError =>
  new DomainError(
    "ORGANIZATION_SLUG_TAKEN",
    `Organization slug "${slug}" is already taken`,
    { slug },
  );

export const OrganizationAggregateStaleError = (): DomainError =>
  new DomainError(
    "ORGANIZATION_AGGREGATE_STALE",
    "Organization was modified by another writer; reload and retry",
  );

export const OrganizationMemberNotFoundError = (): DomainError =>
  new DomainError("ORGANIZATION_MEMBER_NOT_FOUND", "Organization member not found");

export const OrganizationMemberAggregateStaleError = (): DomainError =>
  new DomainError(
    "ORGANIZATION_MEMBER_AGGREGATE_STALE",
    "Organization member was modified by another writer; reload and retry",
  );

// Surfaced when a request is authenticated but the user has no membership in
// the active organization (e.g. removed mid-session, or an org-bound URL hit
// by a foreign user). Distinguished from FORBIDDEN/UNAUTHORIZED so the
// transport layer can map it to a meaningful 403 message.
export const OrganizationMembershipRequiredError = (): DomainError =>
  new DomainError(
    "ORGANIZATION_MEMBERSHIP_REQUIRED",
    "Caller is not a member of this organization",
  );

// "An organization always has exactly one owner" — surfaced when a transition
// would break that invariant (e.g. removing the last owner without transferring
// first, or assigning the `owner` role through `UpdateMemberRole` rather than
// `TransferOwnership`).
export const OrganizationOwnerInvariantError = (message: string): DomainError =>
  new DomainError("ORGANIZATION_OWNER_INVARIANT", message);

// Surfaced when removing the only owner without transfer first. Distinct
// from the generic owner-invariant error so the UI can offer a "transfer
// then remove" remediation flow.
export const OrganizationLastOwnerError = (): DomainError =>
  new DomainError(
    "ORGANIZATION_LAST_OWNER",
    "Cannot remove the last owner of an organization without first transferring ownership",
  );

export const OrganizationInvitationNotFoundError = (): DomainError =>
  new DomainError(
    "ORGANIZATION_INVITATION_NOT_FOUND",
    "Invitation not found",
  );

// Pending → accepted/cancelled/expired is one-way; this fires when a
// caller tries to act on an already-resolved invitation.
export const OrganizationInvitationNotActiveError = (
  status: string,
): DomainError =>
  new DomainError(
    "ORGANIZATION_INVITATION_NOT_ACTIVE",
    `Invitation is no longer pending (status: ${status})`,
    { status },
  );

export const OrganizationInvitationExpiredError = (): DomainError =>
  new DomainError(
    "ORGANIZATION_INVITATION_EXPIRED",
    "Invitation has expired; ask an admin to send a new one",
  );

export const OrganizationInvitationAggregateStaleError = (): DomainError =>
  new DomainError(
    "ORGANIZATION_INVITATION_AGGREGATE_STALE",
    "Invitation was modified by another writer; reload and retry",
  );

// Token + email pair must match. The link can only be redeemed by the
// invited address; otherwise a leaked link would be a free pass into the
// org. Caller-email comes from the authenticated user, not the request body.
export const OrganizationInvitationEmailMismatchError = (): DomainError =>
  new DomainError(
    "ORGANIZATION_INVITATION_EMAIL_MISMATCH",
    "This invitation was issued to a different email address",
  );

// `(organizationId, email)` already has a pending invitation. Admins must
// cancel the existing one before issuing a new one — keeps the audit log
// linear and prevents simultaneous active links to the same recipient.
export const OrganizationInvitationAlreadyPendingError = (): DomainError =>
  new DomainError(
    "ORGANIZATION_INVITATION_ALREADY_PENDING",
    "A pending invitation already exists for this email; cancel it before issuing a new one",
  );

// Version-approval bounded-context errors. Pending → approved/rejected/
// cancelled is one-way; the not-active error fires when a vote arrives
// after the request has already resolved.
export const VersionApprovalRequestNotFoundError = (): DomainError =>
  new DomainError(
    "VERSION_APPROVAL_REQUEST_NOT_FOUND",
    "Version approval request not found",
  );

export const VersionApprovalRequestNotActiveError = (
  status: string,
): DomainError =>
  new DomainError(
    "VERSION_APPROVAL_REQUEST_NOT_ACTIVE",
    `Approval request is no longer pending (status: ${status})`,
    { status },
  );

// Same user voted twice (in either direction) on the same request. UI
// should hide the action; this is the defense-in-depth check.
export const VersionApprovalRequestDuplicateVoteError = (): DomainError =>
  new DomainError(
    "VERSION_APPROVAL_REQUEST_DUPLICATE_VOTE",
    "You have already voted on this approval request",
  );

// Separation of duty: the user who *requested* an approval cannot also
// *approve* it. The request can still be cancelled by the requester.
export const VersionApprovalRequestSelfApprovalError = (): DomainError =>
  new DomainError(
    "VERSION_APPROVAL_REQUEST_SELF_APPROVAL",
    "Requesters cannot approve their own approval request",
  );

export const VersionApprovalRequestAggregateStaleError = (): DomainError =>
  new DomainError(
    "VERSION_APPROVAL_REQUEST_AGGREGATE_STALE",
    "Approval request was modified by another writer; reload and retry",
  );

// One pending request per `(organizationId, versionId)` — multiple
// concurrent requests against the same version would let approvers split
// votes across copies and fragment the audit trail. Surfaces both as a
// pre-check inside the use case and as a unique-index violation at the
// repository boundary.
export const VersionApprovalRequestAlreadyPendingError = (): DomainError =>
  new DomainError(
    "VERSION_APPROVAL_REQUEST_ALREADY_PENDING",
    "A pending approval request already exists for this version",
  );

// Surfaced when `PromoteVersion` is called with target=production while
// the org has an active `approvalPolicy` — caller must use the approval
// workflow (`RequestVersionApproval`) instead.
export const VersionApprovalRequiredError = (): DomainError =>
  new DomainError(
    "VERSION_APPROVAL_REQUIRED",
    "Production promotion requires an approval request when an approval policy is active",
  );

// Surfaced when `RequestVersionApproval` is called against an org that
// has no `approvalPolicy` — the request would have no threshold to
// resolve against.
export const VersionApprovalNotEnabledError = (): DomainError =>
  new DomainError(
    "VERSION_APPROVAL_NOT_ENABLED",
    "Approval workflow is not enabled for this organization",
  );
