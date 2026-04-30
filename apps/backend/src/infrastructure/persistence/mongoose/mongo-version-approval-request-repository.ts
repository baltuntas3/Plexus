import { Types } from "mongoose";
import {
  VersionApprovalRequest,
  type ApprovalVote,
  type VersionApprovalRequestPrimitives,
} from "../../../domain/entities/version-approval-request.js";
import {
  VersionApprovalRequestAggregateStaleError,
  VersionApprovalRequestAlreadyPendingError,
} from "../../../domain/errors/domain-error.js";
import type { IVersionApprovalRequestRepository } from "../../../domain/repositories/version-approval-request-repository.js";
import { isDuplicateKeyError, violatedKeyPatternHas } from "./mongo-errors.js";
import { getCurrentSession } from "./transaction-context.js";
import { VersionApprovalRequestModel } from "./version-approval-request-model.js";

interface ApprovalVoteDoc {
  userId: Types.ObjectId;
  decidedAt: Date;
  comment?: string | null;
}

interface ApprovalRequestDocShape {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  promptId: Types.ObjectId;
  versionId: Types.ObjectId;
  requestedBy: Types.ObjectId;
  requiredApprovals: number;
  approvals: ApprovalVoteDoc[];
  rejections: ApprovalVoteDoc[];
  status: VersionApprovalRequestPrimitives["status"];
  createdAt: Date;
  resolvedAt: Date | null;
  revision?: number;
}

const voteToDoc = (vote: ApprovalVote): ApprovalVoteDoc => ({
  userId: vote.userId as unknown as Types.ObjectId,
  decidedAt: vote.decidedAt,
  comment: vote.comment,
});

const docToVote = (doc: ApprovalVoteDoc): ApprovalVote => ({
  userId: String(doc.userId),
  decidedAt: doc.decidedAt,
  comment: doc.comment ?? null,
});

const toPrimitives = (
  doc: ApprovalRequestDocShape,
): VersionApprovalRequestPrimitives => ({
  id: String(doc._id),
  organizationId: String(doc.organizationId),
  promptId: String(doc.promptId),
  versionId: String(doc.versionId),
  requestedBy: String(doc.requestedBy),
  requiredApprovals: doc.requiredApprovals,
  approvals: doc.approvals.map(docToVote),
  rejections: doc.rejections.map(docToVote),
  status: doc.status,
  createdAt: doc.createdAt,
  resolvedAt: doc.resolvedAt,
  revision: doc.revision ?? 0,
});

export class MongoVersionApprovalRequestRepository
  implements IVersionApprovalRequestRepository
{
  async findById(id: string): Promise<VersionApprovalRequest | null> {
    const session = getCurrentSession();
    const doc = await VersionApprovalRequestModel.findById(id, null, {
      session,
    }).lean<ApprovalRequestDocShape>();
    return doc ? VersionApprovalRequest.hydrate(toPrimitives(doc)) : null;
  }

  async findActivePendingByVersion(
    organizationId: string,
    versionId: string,
  ): Promise<VersionApprovalRequest | null> {
    const session = getCurrentSession();
    const doc = await VersionApprovalRequestModel.findOne(
      { organizationId, versionId, status: "pending" },
      null,
      { session },
    ).lean<ApprovalRequestDocShape>();
    return doc ? VersionApprovalRequest.hydrate(toPrimitives(doc)) : null;
  }

  async listPendingByOrganization(
    organizationId: string,
  ): Promise<VersionApprovalRequest[]> {
    const session = getCurrentSession();
    const docs = await VersionApprovalRequestModel.find(
      { organizationId, status: "pending" },
      null,
      { session },
    )
      .sort({ createdAt: -1 })
      .lean<ApprovalRequestDocShape[]>();
    return docs.map((d) => VersionApprovalRequest.hydrate(toPrimitives(d)));
  }

  async save(request: VersionApprovalRequest): Promise<void> {
    const { primitives, expectedRevision } = request.toSnapshot();
    const session = getCurrentSession();

    if (expectedRevision === 0) {
      try {
        await VersionApprovalRequestModel.create(
          [
            {
              _id: primitives.id,
              organizationId: primitives.organizationId,
              promptId: primitives.promptId,
              versionId: primitives.versionId,
              requestedBy: primitives.requestedBy,
              requiredApprovals: primitives.requiredApprovals,
              approvals: primitives.approvals.map(voteToDoc),
              rejections: primitives.rejections.map(voteToDoc),
              status: primitives.status,
              createdAt: primitives.createdAt,
              resolvedAt: primitives.resolvedAt,
              revision: primitives.revision,
            },
          ],
          { session },
        );
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          // Partial unique on `(organizationId, versionId)` for pending
          // rows. Mirrors `OrganizationInvitationAlreadyPending`: the
          // pre-check `findActivePendingByVersion` is a UX shortcut and
          // this is the integrity barrier under a race.
          if (
            violatedKeyPatternHas(err, "organizationId") &&
            violatedKeyPatternHas(err, "versionId")
          ) {
            throw VersionApprovalRequestAlreadyPendingError();
          }
          throw VersionApprovalRequestAggregateStaleError();
        }
        throw err;
      }
    } else {
      // Vote arrays + status + resolvedAt are the only mutable fields;
      // identifiers and createdAt are immutable post-creation.
      const result = await VersionApprovalRequestModel.updateOne(
        { _id: primitives.id, revision: expectedRevision },
        {
          $set: {
            approvals: primitives.approvals.map(voteToDoc),
            rejections: primitives.rejections.map(voteToDoc),
            status: primitives.status,
            resolvedAt: primitives.resolvedAt,
            revision: primitives.revision,
          },
        },
        { session },
      );
      if (result.matchedCount === 0) {
        throw VersionApprovalRequestAggregateStaleError();
      }
    }

    request.markPersisted();
  }
}
