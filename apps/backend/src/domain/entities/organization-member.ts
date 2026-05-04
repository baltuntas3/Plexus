import {
  ORGANIZATION_ROLES,
  type OrganizationRole,
} from "@plexus/shared-types";
import {
  OrganizationOwnerInvariantError,
  ValidationError,
} from "../errors/domain-error.js";

// Aggregate root for a (user × organization) membership. Each row pairs a
// user with the organization they belong to and the role granted in that
// scope. Same user can hold different roles in different orgs.
//
// Ownership rule: the `owner` role cannot be set or cleared via
// `changeRole`. The cross-aggregate "exactly one owner" invariant lives
// in the `transferOrganizationOwnership` domain service (under
// `domain/services/`); that service is the only legitimate caller of
// `applyOwnershipTransfer` below. The aggregate enforces what it can
// (rejecting any owner-touching transition through `changeRole`) and
// trusts the domain service for the cross-aggregate dance.

export interface OrganizationMemberPrimitives {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  invitedBy: string | null;
  joinedAt: Date;
  revision: number;
}

interface OrganizationMemberSnapshot {
  readonly primitives: OrganizationMemberPrimitives;
  readonly expectedRevision: number;
}

interface CreateOrganizationMemberParams {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  invitedBy?: string | null;
  joinedAt?: Date;
}

export class OrganizationMember {
  private constructor(private state: OrganizationMemberPrimitives) {}

  static create(params: CreateOrganizationMemberParams): OrganizationMember {
    if (!ORGANIZATION_ROLES.includes(params.role)) {
      throw ValidationError(`Unknown organization role: ${params.role}`);
    }
    const joinedAt = params.joinedAt ?? new Date();
    return new OrganizationMember({
      id: params.id,
      organizationId: params.organizationId,
      userId: params.userId,
      role: params.role,
      invitedBy: params.invitedBy ?? null,
      joinedAt,
      revision: 0,
    });
  }

  static hydrate(primitives: OrganizationMemberPrimitives): OrganizationMember {
    return new OrganizationMember({ ...primitives });
  }

  get id(): string {
    return this.state.id;
  }

  get organizationId(): string {
    return this.state.organizationId;
  }

  get userId(): string {
    return this.state.userId;
  }

  get role(): OrganizationRole {
    return this.state.role;
  }

  get invitedBy(): string | null {
    return this.state.invitedBy;
  }

  get joinedAt(): Date {
    return this.state.joinedAt;
  }

  get revision(): number {
    return this.state.revision;
  }

  // Role transition. Refuses to assign or remove `owner` — that path goes
  // through the `TransferOwnership` use case so the org root pointer + the
  // two affected member rows update atomically.
  changeRole(newRole: OrganizationRole): void {
    if (!ORGANIZATION_ROLES.includes(newRole)) {
      throw ValidationError(`Unknown organization role: ${newRole}`);
    }
    if (this.state.role === "owner" || newRole === "owner") {
      throw OrganizationOwnerInvariantError(
        "Owner role can only be transferred via TransferOwnership, not changed in place",
      );
    }
    if (this.state.role === newRole) return;
    this.state = { ...this.state, role: newRole };
  }

  // Restricted to the `transferOrganizationOwnership` domain service.
  // That service is what preserves the cross-aggregate "exactly one owner"
  // invariant by pairing the outgoing demote, the incoming promote, and
  // the org root pointer flip — each individually here is meaningless
  // out of context. TypeScript has no package-private modifier; the
  // restriction is enforced by convention and a single grep audit point.
  applyOwnershipTransfer(direction: "promote" | "demote"): void {
    if (direction === "promote") {
      if (this.state.role === "owner") return;
      this.state = { ...this.state, role: "owner" };
    } else {
      if (this.state.role !== "owner") return;
      this.state = { ...this.state, role: "admin" };
    }
  }

  toSnapshot(): OrganizationMemberSnapshot {
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
