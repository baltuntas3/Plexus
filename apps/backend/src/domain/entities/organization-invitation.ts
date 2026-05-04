import {
  type OrganizationInvitationStatus,
  type OrganizationRole,
} from "@plexus/shared-types";
import {
  OrganizationInvitationExpiredError,
  OrganizationInvitationNotActiveError,
  ValidationError,
} from "../errors/domain-error.js";

// Aggregate root for a pending email-based invitation to join an
// organization. The redemption token is never stored in the clear: only
// its hash lives in the aggregate and DB. The plaintext token is handed
// back exactly once — at issue time — and the recipient consumes it via
// the link in their invitation email.
//
// Status is a one-way state machine:
//
//   pending ──▶ accepted     (recipient clicks link and joins)
//   pending ──▶ cancelled    (admin revokes before redemption)
//   pending ──▶ expired      (lazy: any pending past expiresAt is treated
//                              as expired on read; persisted on the next
//                              save by the use case)
//
// Once non-pending the aggregate refuses any further state transition —
// re-issuing requires creating a new invitation.

const VALID_ROLES_FOR_INVITE: ReadonlySet<OrganizationRole> = new Set([
  "admin",
  "editor",
  "approver",
  "viewer",
]);

export interface OrganizationInvitationPrimitives {
  id: string;
  organizationId: string;
  // Lowercased + trimmed at the boundary so equality lookups (`findByEmail`)
  // are case-insensitive without per-call normalization.
  email: string;
  role: OrganizationRole;
  invitedBy: string;
  // SHA-256 hex of the plaintext token. The token never enters the
  // aggregate's state — `create()` returns it once via the factory result
  // alongside the aggregate, and the caller forwards it to the recipient.
  tokenHash: string;
  status: OrganizationInvitationStatus;
  expiresAt: Date;
  createdAt: Date;
  resolvedAt: Date | null;
  revision: number;
}

interface OrganizationInvitationSnapshot {
  readonly primitives: OrganizationInvitationPrimitives;
  readonly expectedRevision: number;
}

interface CreateOrganizationInvitationParams {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
  invitedBy: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt?: Date;
}

export class OrganizationInvitation {
  private constructor(private state: OrganizationInvitationPrimitives) {}

  static create(
    params: CreateOrganizationInvitationParams,
  ): OrganizationInvitation {
    if (!VALID_ROLES_FOR_INVITE.has(params.role)) {
      // `owner` is reserved for the founding registration + ownership
      // transfer flows. An invitation with role=owner would create a
      // second owner if accepted, breaking the single-owner invariant.
      throw ValidationError(
        `Cannot invite with role "${params.role}" — owner role is reserved for ownership transfer`,
      );
    }
    const email = normalizeEmail(params.email);
    const createdAt = params.createdAt ?? new Date();
    if (params.expiresAt.getTime() <= createdAt.getTime()) {
      throw ValidationError("Invitation expiresAt must be after createdAt");
    }
    return new OrganizationInvitation({
      id: params.id,
      organizationId: params.organizationId,
      email,
      role: params.role,
      invitedBy: params.invitedBy,
      tokenHash: params.tokenHash,
      status: "pending",
      expiresAt: params.expiresAt,
      createdAt,
      resolvedAt: null,
      revision: 0,
    });
  }

  static hydrate(
    primitives: OrganizationInvitationPrimitives,
  ): OrganizationInvitation {
    return new OrganizationInvitation({ ...primitives });
  }

  get id(): string {
    return this.state.id;
  }

  get organizationId(): string {
    return this.state.organizationId;
  }

  get email(): string {
    return this.state.email;
  }

  get role(): OrganizationRole {
    return this.state.role;
  }

  get invitedBy(): string {
    return this.state.invitedBy;
  }

  get tokenHash(): string {
    return this.state.tokenHash;
  }

  get status(): OrganizationInvitationStatus {
    return this.state.status;
  }

  get expiresAt(): Date {
    return this.state.expiresAt;
  }

  get createdAt(): Date {
    return this.state.createdAt;
  }

  get resolvedAt(): Date | null {
    return this.state.resolvedAt;
  }

  get revision(): number {
    return this.state.revision;
  }

  isExpiredAt(now: Date): boolean {
    return this.state.expiresAt.getTime() <= now.getTime();
  }

  // Asserts the invitation is currently redeemable. Combines the static
  // status check (pending) with the time-based one (not past expiresAt).
  // Use cases call this before applying `accept()` so the two error
  // codes (NOT_ACTIVE vs EXPIRED) surface separately to the API.
  assertRedeemableAt(now: Date): void {
    if (this.state.status !== "pending") {
      throw OrganizationInvitationNotActiveError(this.state.status);
    }
    if (this.isExpiredAt(now)) {
      throw OrganizationInvitationExpiredError();
    }
  }

  cancel(now: Date = new Date()): void {
    if (this.state.status !== "pending") {
      throw OrganizationInvitationNotActiveError(this.state.status);
    }
    this.state = { ...this.state, status: "cancelled", resolvedAt: now };
  }

  accept(now: Date = new Date()): void {
    this.assertRedeemableAt(now);
    this.state = { ...this.state, status: "accepted", resolvedAt: now };
  }

  // Used by the use case when a read finds a pending row that has
  // already passed `expiresAt`. Persists the lazy expiration so future
  // queries don't have to recompute it. Idempotent: a second call on an
  // already-expired row is a no-op.
  markExpired(now: Date = new Date()): void {
    if (this.state.status === "expired") return;
    if (this.state.status !== "pending") {
      throw OrganizationInvitationNotActiveError(this.state.status);
    }
    this.state = { ...this.state, status: "expired", resolvedAt: now };
  }

  toSnapshot(): OrganizationInvitationSnapshot {
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

const normalizeEmail = (raw: string): string => {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0 || !trimmed.includes("@")) {
    throw ValidationError(`Invalid invitation email: "${raw}"`);
  }
  return trimmed;
};

