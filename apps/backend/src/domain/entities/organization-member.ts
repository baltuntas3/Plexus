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
// `changeRole`. That transition is reserved for the `TransferOwnership`
// use case (Faz 1B-C) which will atomically update two member rows plus
// the org root pointer in a single UoW; the escape-hatch mutation method
// will be added on this aggregate at the same time. Until then the
// aggregate's invariant — "exactly one owner, never assigned in place" —
// is enforced by `changeRole` rejecting any owner-touching transition.

export interface OrganizationMemberPrimitives {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  invitedBy: string | null;
  joinedAt: Date;
  revision: number;
}

export interface OrganizationMemberSnapshot {
  readonly primitives: OrganizationMemberPrimitives;
  readonly expectedRevision: number;
}

export interface CreateOrganizationMemberParams {
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
