import type { ApprovalPolicy, OrganizationRole } from "@plexus/shared-types";
import { ValidationError } from "../errors/domain-error.js";

// Slug grammar: URL-safe, lowercase, hyphen-separated. The pattern is
// asserted at the aggregate boundary so an invalid slug cannot reach
// persistence — duplicate-detection is a separate repository-level concern
// (`findBySlug` + a unique index).
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const NAME_MIN = 1;
const NAME_MAX = 120;

// 1: minimum useful production gate (one approver). 10: arbitrary upper
// bound that keeps the eventual approver-list UI finite. Lifted to
// constants so the future "per-org-tier max" lookup can swap them
// without hunting magic numbers.
const MIN_REQUIRED_APPROVALS = 1;
const MAX_REQUIRED_APPROVALS = 10;

// Aggregate root for the registration unit of the platform. Every other
// aggregate (Prompt, Benchmark, Dataset, ...) carries an `organizationId`
// pointing back here; this entity owns the organization-level invariants
// (name, slug, owner pointer) without knowing about its child aggregates.
//
// Ownership invariant: `ownerId` always matches an `OrganizationMember` row
// with `role = "owner"`. The mutation that transfers ownership is therefore
// atomic across this root and a member row, orchestrated by a use case
// inside a UoW. The aggregate itself only validates the field; cross-
// aggregate consistency is the use case's job.

export interface OrganizationPrimitives {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  // Null until an owner/admin sets it. When present, `→ production`
  // promotions are routed through the `VersionApprovalRequest` workflow
  // instead of resolving directly via `version:promote`.
  approvalPolicy: ApprovalPolicy | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationSnapshot {
  readonly primitives: OrganizationPrimitives;
  readonly expectedRevision: number;
}

export interface CreateOrganizationParams {
  organizationId: string;
  name: string;
  slug: string;
  ownerId: string;
  approvalPolicy?: ApprovalPolicy | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Organization {
  private constructor(private state: OrganizationPrimitives) {}

  static create(params: CreateOrganizationParams): Organization {
    const name = normalizeName(params.name);
    const slug = normalizeSlug(params.slug);
    const approvalPolicy = params.approvalPolicy
      ? normalizeApprovalPolicy(params.approvalPolicy)
      : null;
    const now = params.createdAt ?? new Date();
    return new Organization({
      id: params.organizationId,
      name,
      slug,
      ownerId: params.ownerId,
      approvalPolicy,
      revision: 0,
      createdAt: now,
      updatedAt: params.updatedAt ?? now,
    });
  }

  static hydrate(primitives: OrganizationPrimitives): Organization {
    return new Organization({ ...primitives });
  }

  get id(): string {
    return this.state.id;
  }

  get name(): string {
    return this.state.name;
  }

  get slug(): string {
    return this.state.slug;
  }

  get ownerId(): string {
    return this.state.ownerId;
  }

  get approvalPolicy(): ApprovalPolicy | null {
    return this.state.approvalPolicy;
  }

  get revision(): number {
    return this.state.revision;
  }

  get createdAt(): Date {
    return this.state.createdAt;
  }

  get updatedAt(): Date {
    return this.state.updatedAt;
  }

  // Pointer-only mutation, paired with two `OrganizationMember` updates
  // by the `TransferOwnership` use case inside a single UoW so the
  // root's `ownerId` and the member rows never disagree.
  setOwnerId(newOwnerId: string): void {
    if (this.state.ownerId === newOwnerId) return;
    this.state = { ...this.state, ownerId: newOwnerId, updatedAt: new Date() };
  }

  // `null` clears the gate: subsequent `→ production` promotions go
  // through the direct `version:promote` path again. Existing in-flight
  // approval requests are unaffected — they keep their snapshot of the
  // threshold they were created under (see `VersionApprovalRequest`).
  setApprovalPolicy(policy: ApprovalPolicy | null): void {
    const next = policy ? normalizeApprovalPolicy(policy) : null;
    const current = this.state.approvalPolicy;
    if (next === null && current === null) return;
    if (
      next !== null
      && current !== null
      && next.requiredApprovals === current.requiredApprovals
    ) {
      return;
    }
    this.state = { ...this.state, approvalPolicy: next, updatedAt: new Date() };
  }

  toSnapshot(): OrganizationSnapshot {
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

const normalizeName = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
    throw ValidationError(`Organization name must be ${NAME_MIN}-${NAME_MAX} chars`);
  }
  return trimmed;
};

const normalizeSlug = (raw: string): string => {
  const lowered = raw.trim().toLowerCase();
  if (!SLUG_PATTERN.test(lowered)) {
    throw ValidationError(
      `Invalid organization slug "${raw}"; must match ${SLUG_PATTERN}`,
    );
  }
  return lowered;
};

const normalizeApprovalPolicy = (policy: ApprovalPolicy): ApprovalPolicy => {
  if (!Number.isInteger(policy.requiredApprovals)) {
    throw ValidationError("requiredApprovals must be an integer");
  }
  if (
    policy.requiredApprovals < MIN_REQUIRED_APPROVALS
    || policy.requiredApprovals > MAX_REQUIRED_APPROVALS
  ) {
    throw ValidationError(
      `requiredApprovals must be between ${MIN_REQUIRED_APPROVALS} and ${MAX_REQUIRED_APPROVALS}`,
    );
  }
  return { requiredApprovals: policy.requiredApprovals };
};

// Unicode combining diacritical marks block (U+0300..U+036F). After NFKD
// decomposition, accented characters become "base + combining mark"; this
// pattern strips the marks so "Açme" → "acme" cleanly. Written with hex
// escapes rather than literal characters so the regex stays readable in
// tooling that does not render combining marks as standalone glyphs.
const COMBINING_MARKS_PATTERN = /[̀-ͯ]/g;

// Derives a candidate slug from a free-form organization name. Use cases
// pass this through `findBySlug` + collision-resolution before persistence;
// the helper itself only does the deterministic normalization step.
export const slugifyOrganizationName = (name: string): string => {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_MARKS_PATTERN, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug.length > 0 ? slug : "org";
};

export type { OrganizationRole };
