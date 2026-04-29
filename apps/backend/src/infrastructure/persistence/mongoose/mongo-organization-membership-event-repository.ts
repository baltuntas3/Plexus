import { Types } from "mongoose";
import type { IOrganizationMembershipEventRepository } from "../../../domain/repositories/organization-membership-event-repository.js";
import {
  OrganizationMembershipEvent,
  type OrganizationMembershipEventPrimitives,
} from "../../../domain/entities/organization-membership-event.js";
import { OrganizationMembershipEventModel } from "./organization-membership-event-model.js";
import { getCurrentSession } from "./transaction-context.js";

interface EventDocShape {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  eventType: OrganizationMembershipEventPrimitives["eventType"];
  actorUserId: Types.ObjectId;
  targetUserId: Types.ObjectId | null;
  targetEmail: string | null;
  oldRole: OrganizationMembershipEventPrimitives["oldRole"];
  newRole: OrganizationMembershipEventPrimitives["newRole"];
  occurredAt: Date;
}

const toPrimitives = (
  doc: EventDocShape,
): OrganizationMembershipEventPrimitives => ({
  id: String(doc._id),
  organizationId: String(doc.organizationId),
  eventType: doc.eventType,
  actorUserId: String(doc.actorUserId),
  targetUserId: doc.targetUserId ? String(doc.targetUserId) : null,
  targetEmail: doc.targetEmail,
  oldRole: doc.oldRole,
  newRole: doc.newRole,
  occurredAt: doc.occurredAt,
});

export class MongoOrganizationMembershipEventRepository
  implements IOrganizationMembershipEventRepository
{
  async append(event: OrganizationMembershipEvent): Promise<void> {
    const primitives = event.toPrimitives();
    const session = getCurrentSession();
    // Append-only — no `updateOne`/conflict handling. Duplicate id
    // would be a programmer error; the driver will surface it as a
    // duplicate-key error and the use case fails. We don't translate
    // it because the only path here is `idGenerator.newId()`, which
    // must produce uniques.
    await OrganizationMembershipEventModel.create(
      [
        {
          _id: primitives.id,
          organizationId: primitives.organizationId,
          eventType: primitives.eventType,
          actorUserId: primitives.actorUserId,
          targetUserId: primitives.targetUserId,
          targetEmail: primitives.targetEmail,
          oldRole: primitives.oldRole,
          newRole: primitives.newRole,
          occurredAt: primitives.occurredAt,
        },
      ],
      { session },
    );
  }

  async listByOrganization(
    organizationId: string,
  ): Promise<OrganizationMembershipEvent[]> {
    const session = getCurrentSession();
    const docs = await OrganizationMembershipEventModel.find(
      { organizationId },
      null,
      { session },
    )
      .sort({ occurredAt: -1 })
      .lean<EventDocShape[]>();
    return docs.map((d) => OrganizationMembershipEvent.hydrate(toPrimitives(d)));
  }
}
