import type {
  OrganizationMembershipEventType,
  OrganizationRole,
} from "@plexus/shared-types";
import { ValidationError } from "../errors/domain-error.js";

// Append-only audit log row. Unlike Organization/OrganizationMember this is
// not an aggregate root with a state machine — once written, never changed.
// The repository exposes `append` + `listByOrganization`; no `save`/`update`.
//
// Each event records *who* did *what* to *whom*. The `targetUserId`/
// `targetEmail` discriminator captures the asymmetry of an invitation
// flow: "invited" + "cancelled" reference a recipient by email (no user
// row yet), every other event references a member by userId.

export interface OrganizationMembershipEventPrimitives {
  id: string;
  organizationId: string;
  eventType: OrganizationMembershipEventType;
  actorUserId: string;
  targetUserId: string | null;
  targetEmail: string | null;
  oldRole: OrganizationRole | null;
  newRole: OrganizationRole | null;
  occurredAt: Date;
}

interface AppendOrganizationMembershipEventParams {
  id: string;
  organizationId: string;
  eventType: OrganizationMembershipEventType;
  actorUserId: string;
  targetUserId?: string | null;
  targetEmail?: string | null;
  oldRole?: OrganizationRole | null;
  newRole?: OrganizationRole | null;
  occurredAt?: Date;
}

export class OrganizationMembershipEvent {
  private constructor(
    private readonly state: OrganizationMembershipEventPrimitives,
  ) {}

  static create(
    params: AppendOrganizationMembershipEventParams,
  ): OrganizationMembershipEvent {
    const targetUserId = params.targetUserId ?? null;
    const targetEmail = params.targetEmail ?? null;
    if (targetUserId === null && targetEmail === null) {
      throw ValidationError(
        "Membership event must reference either a targetUserId or a targetEmail",
      );
    }
    return new OrganizationMembershipEvent({
      id: params.id,
      organizationId: params.organizationId,
      eventType: params.eventType,
      actorUserId: params.actorUserId,
      targetUserId,
      targetEmail,
      oldRole: params.oldRole ?? null,
      newRole: params.newRole ?? null,
      occurredAt: params.occurredAt ?? new Date(),
    });
  }

  static hydrate(
    primitives: OrganizationMembershipEventPrimitives,
  ): OrganizationMembershipEvent {
    return new OrganizationMembershipEvent({ ...primitives });
  }

  get id(): string {
    return this.state.id;
  }

  get organizationId(): string {
    return this.state.organizationId;
  }

  get eventType(): OrganizationMembershipEventType {
    return this.state.eventType;
  }

  get actorUserId(): string {
    return this.state.actorUserId;
  }

  get targetUserId(): string | null {
    return this.state.targetUserId;
  }

  get targetEmail(): string | null {
    return this.state.targetEmail;
  }

  get oldRole(): OrganizationRole | null {
    return this.state.oldRole;
  }

  get newRole(): OrganizationRole | null {
    return this.state.newRole;
  }

  get occurredAt(): Date {
    return this.state.occurredAt;
  }

  toPrimitives(): OrganizationMembershipEventPrimitives {
    return { ...this.state };
  }
}
