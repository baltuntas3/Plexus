import { Types } from "mongoose";
import type { IOrganizationInvitationRepository } from "../../../domain/repositories/organization-invitation-repository.js";
import {
  OrganizationInvitation,
  type OrganizationInvitationPrimitives,
} from "../../../domain/entities/organization-invitation.js";
import {
  OrganizationInvitationAggregateStaleError,
  OrganizationInvitationAlreadyPendingError,
} from "../../../domain/errors/domain-error.js";
import { OrganizationInvitationModel } from "./organization-invitation-model.js";
import {
  isDuplicateKeyError,
  violatedKeyPatternHas,
} from "./mongo-errors.js";
import { getCurrentSession } from "./transaction-context.js";

interface InvitationDocShape {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  email: string;
  role: OrganizationInvitationPrimitives["role"];
  invitedBy: Types.ObjectId;
  tokenHash: string;
  status: OrganizationInvitationPrimitives["status"];
  expiresAt: Date;
  resolvedAt: Date | null;
  revision?: number;
  createdAt: Date;
}

const toPrimitives = (
  doc: InvitationDocShape,
): OrganizationInvitationPrimitives => ({
  id: String(doc._id),
  organizationId: String(doc.organizationId),
  email: doc.email,
  role: doc.role,
  invitedBy: String(doc.invitedBy),
  tokenHash: doc.tokenHash,
  status: doc.status,
  expiresAt: doc.expiresAt,
  createdAt: doc.createdAt,
  resolvedAt: doc.resolvedAt,
  revision: doc.revision ?? 0,
});

export class MongoOrganizationInvitationRepository
  implements IOrganizationInvitationRepository
{
  async findById(id: string): Promise<OrganizationInvitation | null> {
    const session = getCurrentSession();
    const doc = await OrganizationInvitationModel.findById(id, null, {
      session,
    }).lean<InvitationDocShape>();
    return doc ? OrganizationInvitation.hydrate(toPrimitives(doc)) : null;
  }

  async findActiveByOrganizationAndEmail(
    organizationId: string,
    email: string,
  ): Promise<OrganizationInvitation | null> {
    const session = getCurrentSession();
    const doc = await OrganizationInvitationModel.findOne(
      { organizationId, email: email.toLowerCase().trim(), status: "pending" },
      null,
      { session },
    ).lean<InvitationDocShape>();
    return doc ? OrganizationInvitation.hydrate(toPrimitives(doc)) : null;
  }

  async findByTokenHash(
    tokenHash: string,
  ): Promise<OrganizationInvitation | null> {
    const session = getCurrentSession();
    const doc = await OrganizationInvitationModel.findOne(
      { tokenHash },
      null,
      { session },
    ).lean<InvitationDocShape>();
    return doc ? OrganizationInvitation.hydrate(toPrimitives(doc)) : null;
  }

  async listByOrganization(
    organizationId: string,
  ): Promise<OrganizationInvitation[]> {
    const session = getCurrentSession();
    const docs = await OrganizationInvitationModel.find(
      { organizationId },
      null,
      { session },
    )
      .sort({ createdAt: -1 })
      .lean<InvitationDocShape[]>();
    return docs.map((d) => OrganizationInvitation.hydrate(toPrimitives(d)));
  }

  async save(invitation: OrganizationInvitation): Promise<void> {
    const { primitives, expectedRevision } = invitation.toSnapshot();
    const session = getCurrentSession();

    if (expectedRevision === 0) {
      try {
        await OrganizationInvitationModel.create(
          [
            {
              _id: primitives.id,
              organizationId: primitives.organizationId,
              email: primitives.email,
              role: primitives.role,
              invitedBy: primitives.invitedBy,
              tokenHash: primitives.tokenHash,
              status: primitives.status,
              expiresAt: primitives.expiresAt,
              resolvedAt: primitives.resolvedAt,
              revision: primitives.revision,
              createdAt: primitives.createdAt,
            },
          ],
          { session },
        );
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          // The partial unique index on `(organizationId, email)` for
          // pending rows surfaces here when an admin tries to issue a
          // second invitation while one is still pending. The
          // `tokenHash` index — also unique — surfaces as a generic
          // stale aggregate (the chance of a 32-byte random collision
          // is astronomically small; we model it as concurrency).
          if (
            violatedKeyPatternHas(err, "organizationId") &&
            violatedKeyPatternHas(err, "email")
          ) {
            throw OrganizationInvitationAlreadyPendingError();
          }
          throw OrganizationInvitationAggregateStaleError();
        }
        throw err;
      }
    } else {
      const result = await OrganizationInvitationModel.updateOne(
        { _id: primitives.id, revision: expectedRevision },
        {
          $set: {
            status: primitives.status,
            resolvedAt: primitives.resolvedAt,
            revision: primitives.revision,
          },
        },
        { session },
      );
      if (result.matchedCount === 0) {
        throw OrganizationInvitationAggregateStaleError();
      }
    }

    invitation.markPersisted();
  }
}
