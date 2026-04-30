import type { ISODateString } from "./common.js";

// Production-promotion approval ticket. One per outstanding
// `→ production` request when the org has an `ApprovalPolicy`. The
// aggregate is its own root (not a child of PromptVersion) so the
// approver workflow — voting, listing pending requests across the org —
// can move forward without fanning out into the prompt aggregate's
// concurrency window.
export const APPROVAL_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const;
export type VersionApprovalRequestStatus =
  (typeof APPROVAL_REQUEST_STATUSES)[number];

// One vote on an approval request. Carries the voter, when they voted,
// and an optional comment so the audit trail captures *why* an approver
// signed off (or rejected). Plan §4 specifies this shape; UI renders the
// list as a timeline alongside the request's overall status.
export interface VersionApprovalVoteDto {
  userId: string;
  decidedAt: ISODateString;
  // Free-form note. Optional — most votes carry none — but compliance/
  // legal flows benefit from it. Trimmed to non-empty server-side; null
  // means "no note attached."
  comment: string | null;
}

export interface VersionApprovalRequestDto {
  id: string;
  organizationId: string;
  promptId: string;
  // Display-friendly prompt name resolved server-side at projection
  // time. Approver inboxes need the name to identify what they're
  // voting on; clients shouldn't have to fan out a second list call.
  promptName: string;
  versionId: string;
  // Version label like `v3` (the user-facing identifier). Same
  // motivation as `promptName`: pre-resolved server-side.
  versionLabel: string;
  // The user who initiated the request. Cannot also approve their own
  // request — separation of duty is enforced inside the aggregate.
  requestedBy: string;
  // Snapshot of `Organization.approvalPolicy.requiredApprovals` at
  // creation time. Locked here so that lowering the policy mid-flight
  // does not retroactively shrink an in-flight request's threshold (and
  // raising it does not strand a request that already met the previous
  // bar).
  requiredApprovals: number;
  // Vote rows in insertion order. UI surfaces them as an audit timeline.
  approvals: VersionApprovalVoteDto[];
  rejections: VersionApprovalVoteDto[];
  status: VersionApprovalRequestStatus;
  createdAt: ISODateString;
  // Set when the request leaves `pending` (approved threshold reached,
  // anyone rejected, or the requester / an admin cancelled).
  resolvedAt: ISODateString | null;
}
