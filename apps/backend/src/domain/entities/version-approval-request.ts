import type { VersionApprovalRequestStatus } from "@plexus/shared-types";
import {
  ValidationError,
  VersionApprovalRequestDuplicateVoteError,
  VersionApprovalRequestNotActiveError,
  VersionApprovalRequestSelfApprovalError,
} from "../errors/domain-error.js";

// One vote on a request. Carries voter, decision time, and an optional
// trimmed comment (compliance/legal sign-offs benefit from a note). The
// comment is normalised to non-empty-or-null so empty strings cannot
// masquerade as "I left a note."
export interface ApprovalVote {
  userId: string;
  decidedAt: Date;
  comment: string | null;
}

// Aggregate root for a single `→ production` promotion request when the
// owning org has an `approvalPolicy`. Concurrency-safe via the
// snapshot/markPersisted protocol used by every other write aggregate
// in the codebase. Lives outside the Prompt aggregate boundary on
// purpose: voting traffic and prompt-edit traffic are independent
// optimistic-concurrency windows, and bundling them would force every
// approver vote to compete with concurrent prompt edits for the
// PromptVersion's revision.

export interface VersionApprovalRequestPrimitives {
  id: string;
  organizationId: string;
  promptId: string;
  versionId: string;
  requestedBy: string;
  // Snapshot of `Organization.approvalPolicy.requiredApprovals` at
  // creation time. Locked here so policy changes mid-flight neither
  // shrink an in-flight threshold nor strand a request that already met
  // the previous bar. See the corresponding shared-type comment.
  requiredApprovals: number;
  approvals: ReadonlyArray<ApprovalVote>;
  rejections: ReadonlyArray<ApprovalVote>;
  status: VersionApprovalRequestStatus;
  createdAt: Date;
  resolvedAt: Date | null;
  revision: number;
}

export interface VersionApprovalRequestSnapshot {
  readonly primitives: VersionApprovalRequestPrimitives;
  readonly expectedRevision: number;
}

export interface CreateVersionApprovalRequestParams {
  id: string;
  organizationId: string;
  promptId: string;
  versionId: string;
  requestedBy: string;
  requiredApprovals: number;
  createdAt?: Date;
}

export class VersionApprovalRequest {
  private constructor(private state: VersionApprovalRequestPrimitives) {}

  static create(
    params: CreateVersionApprovalRequestParams,
  ): VersionApprovalRequest {
    if (!Number.isInteger(params.requiredApprovals) || params.requiredApprovals < 1) {
      throw ValidationError("requiredApprovals must be a positive integer");
    }
    return new VersionApprovalRequest({
      id: params.id,
      organizationId: params.organizationId,
      promptId: params.promptId,
      versionId: params.versionId,
      requestedBy: params.requestedBy,
      requiredApprovals: params.requiredApprovals,
      approvals: [],
      rejections: [],
      status: "pending",
      createdAt: params.createdAt ?? new Date(),
      resolvedAt: null,
      revision: 0,
    });
  }

  static hydrate(
    primitives: VersionApprovalRequestPrimitives,
  ): VersionApprovalRequest {
    return new VersionApprovalRequest({
      ...primitives,
      approvals: primitives.approvals.map(cloneVote),
      rejections: primitives.rejections.map(cloneVote),
    });
  }

  get id(): string {
    return this.state.id;
  }

  get organizationId(): string {
    return this.state.organizationId;
  }

  get promptId(): string {
    return this.state.promptId;
  }

  get versionId(): string {
    return this.state.versionId;
  }

  get requestedBy(): string {
    return this.state.requestedBy;
  }

  get requiredApprovals(): number {
    return this.state.requiredApprovals;
  }

  get approvals(): ReadonlyArray<ApprovalVote> {
    return this.state.approvals;
  }

  get rejections(): ReadonlyArray<ApprovalVote> {
    return this.state.rejections;
  }

  get status(): VersionApprovalRequestStatus {
    return this.state.status;
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

  // Indicates the *aggregate-internal* resolution state — true means the
  // approval threshold was just hit by this vote, so the orchestrating
  // use case should also flip the version's status to `production`
  // inside the same UoW.
  get isApproved(): boolean {
    return this.state.status === "approved";
  }

  // Records an "approve" vote. The state machine here is the single
  // place threshold-crossing is detected; once crossed, the request
  // resolves to `approved` *atomically with the same vote* — the use
  // case never observes a transient "Nth approval but still pending"
  // state. Auto-resolution is what lets the policy be a passive count
  // (no separate "close request" call needed).
  approve(
    actorUserId: string,
    options: { now?: Date; comment?: string | null } = {},
  ): void {
    this.assertPending();
    if (actorUserId === this.state.requestedBy) {
      throw VersionApprovalRequestSelfApprovalError();
    }
    this.assertHasNotVoted(actorUserId);
    const now = options.now ?? new Date();
    const vote: ApprovalVote = {
      userId: actorUserId,
      decidedAt: now,
      comment: normaliseComment(options.comment),
    };
    const approvals = [...this.state.approvals, vote];
    const reachedThreshold = approvals.length >= this.state.requiredApprovals;
    this.state = {
      ...this.state,
      approvals,
      status: reachedThreshold ? "approved" : "pending",
      resolvedAt: reachedThreshold ? now : null,
    };
  }

  // Single-rejection-blocks rather than counting rejections against a
  // separate threshold. Justification: production gates are
  // conservative — if any approver objects, the safe default is to
  // resolve as rejected and force the requester to re-issue after
  // addressing the objection, rather than letting majority overrule
  // dissent silently.
  reject(
    actorUserId: string,
    options: { now?: Date; comment?: string | null } = {},
  ): void {
    this.assertPending();
    this.assertHasNotVoted(actorUserId);
    const now = options.now ?? new Date();
    const vote: ApprovalVote = {
      userId: actorUserId,
      decidedAt: now,
      comment: normaliseComment(options.comment),
    };
    this.state = {
      ...this.state,
      rejections: [...this.state.rejections, vote],
      status: "rejected",
      resolvedAt: now,
    };
  }

  // Cancellation is non-vote: no `actorUserId` recorded on the
  // aggregate. The audit trail (who cancelled, when) lives in the
  // membership/version event stream maintained by the orchestrating use
  // case, not on this row.
  cancel(now: Date = new Date()): void {
    this.assertPending();
    this.state = { ...this.state, status: "cancelled", resolvedAt: now };
  }

  private assertPending(): void {
    if (this.state.status !== "pending") {
      throw VersionApprovalRequestNotActiveError(this.state.status);
    }
  }

  private assertHasNotVoted(actorUserId: string): void {
    if (
      this.state.approvals.some((v) => v.userId === actorUserId)
      || this.state.rejections.some((v) => v.userId === actorUserId)
    ) {
      throw VersionApprovalRequestDuplicateVoteError();
    }
  }

  toSnapshot(): VersionApprovalRequestSnapshot {
    const expectedRevision = this.state.revision;
    return {
      primitives: {
        ...this.state,
        approvals: this.state.approvals.map(cloneVote),
        rejections: this.state.rejections.map(cloneVote),
        revision: expectedRevision + 1,
      },
      expectedRevision,
    };
  }

  markPersisted(): void {
    this.state = { ...this.state, revision: this.state.revision + 1 };
  }
}

const cloneVote = (v: ApprovalVote): ApprovalVote => ({
  userId: v.userId,
  decidedAt: v.decidedAt,
  comment: v.comment,
});

const normaliseComment = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};
