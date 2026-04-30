import type {
  VersionApprovalRequestDto,
  VersionApprovalVoteDto,
} from "@plexus/shared-types";
import type {
  ApprovalVote,
  VersionApprovalRequest,
} from "../../domain/entities/version-approval-request.js";

// Display-friendly metadata the projection needs but the aggregate
// doesn't carry. The orchestrating use case resolves these from the
// prompt + version repositories and passes them in. Decoupling lookup
// from projection keeps the mapper a pure function and lets list-style
// use cases batch their lookups before mapping.
export interface ApprovalRequestDisplayContext {
  promptName: string;
  versionLabel: string;
}

// Single source of truth for the approval-request entity → DTO
// projection. Mirrors `organization-projections.ts` so use cases at
// every boundary (issue, vote, list) emit the same shape and the vote
// timeline (userId / decidedAt / comment) is serialised consistently.

const voteToDto = (vote: ApprovalVote): VersionApprovalVoteDto => ({
  userId: vote.userId,
  decidedAt: vote.decidedAt.toISOString(),
  comment: vote.comment,
});

export const toVersionApprovalRequestDto = (
  request: VersionApprovalRequest,
  context: ApprovalRequestDisplayContext,
): VersionApprovalRequestDto => ({
  id: request.id,
  organizationId: request.organizationId,
  promptId: request.promptId,
  promptName: context.promptName,
  versionId: request.versionId,
  versionLabel: context.versionLabel,
  requestedBy: request.requestedBy,
  requiredApprovals: request.requiredApprovals,
  approvals: request.approvals.map(voteToDto),
  rejections: request.rejections.map(voteToDto),
  status: request.status,
  createdAt: request.createdAt.toISOString(),
  resolvedAt: request.resolvedAt
    ? request.resolvedAt.toISOString()
    : null,
});
