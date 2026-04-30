import { Schema, model } from "mongoose";
import { APPROVAL_REQUEST_STATUSES } from "@plexus/shared-types";

const versionApprovalRequestSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    promptId: { type: Schema.Types.ObjectId, ref: "Prompt", required: true },
    versionId: {
      type: Schema.Types.ObjectId,
      ref: "PromptVersion",
      required: true,
    },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    requiredApprovals: { type: Number, required: true },
    // Vote subdocs. Each row carries voter, decision time, and an
    // optional comment so the timeline reflects *who decided when, with
    // what note* — plain user-id arrays would lose that context.
    approvals: [
      {
        _id: false,
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        decidedAt: { type: Date, required: true },
        comment: { type: String, default: null },
      },
    ],
    rejections: [
      {
        _id: false,
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        decidedAt: { type: Date, required: true },
        comment: { type: String, default: null },
      },
    ],
    status: {
      type: String,
      enum: APPROVAL_REQUEST_STATUSES,
      required: true,
      default: "pending",
    },
    // Set when the request leaves `pending`. Used by the inbox query to
    // sort resolved rows below pending if a future endpoint surfaces
    // them; pending listing today is filtered by `status` directly.
    resolvedAt: { type: Date, default: null },
    revision: { type: Number, required: true, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Pending inbox lookup: org-scoped, filtered to active rows only.
versionApprovalRequestSchema.index({ organizationId: 1, status: 1 });

// One pending request per `(organizationId, versionId)`. Partial filter
// so resolved rows don't block re-issue after a rejection or
// cancellation. The unique-index violation is the integrity barrier
// that backs the `findActivePendingByVersion` pre-check; without the
// index, a race could persist two pending rows.
versionApprovalRequestSchema.index(
  { organizationId: 1, versionId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" },
    name: "uniq_pending_per_version",
  },
);

export const VersionApprovalRequestModel = model(
  "VersionApprovalRequest",
  versionApprovalRequestSchema,
);
