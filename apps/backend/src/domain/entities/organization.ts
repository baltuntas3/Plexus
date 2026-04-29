import type { OrganizationRole } from "@plexus/shared-types";
import { ValidationError } from "../errors/domain-error.js";

// Slug grammar: URL-safe, lowercase, hyphen-separated. The pattern is
// asserted at the aggregate boundary so an invalid slug cannot reach
// persistence — duplicate-detection is a separate repository-level concern
// (`findBySlug` + a unique index).
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const NAME_MIN = 1;
const NAME_MAX = 120;

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
  createdAt?: Date;
  updatedAt?: Date;
}

export class Organization {
  private constructor(private state: OrganizationPrimitives) {}

  static create(params: CreateOrganizationParams): Organization {
    const name = normalizeName(params.name);
    const slug = normalizeSlug(params.slug);
    const now = params.createdAt ?? new Date();
    return new Organization({
      id: params.organizationId,
      name,
      slug,
      ownerId: params.ownerId,
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
