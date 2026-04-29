import { Schema, model } from "mongoose";
import {
  INVITATION_STATUSES,
  ORGANIZATION_ROLES,
} from "@plexus/shared-types";

const organizationInvitationSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, required: true, enum: ORGANIZATION_ROLES },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // SHA-256 hex of the plaintext token. Indexed unique because the
    // redemption path is "hash incoming → find by hash" — collision
    // would let two invitations share the same link.
    tokenHash: { type: String, required: true, unique: true },
    status: { type: String, required: true, enum: INVITATION_STATUSES },
    expiresAt: { type: Date, required: true },
    resolvedAt: { type: Date, default: null },
    revision: { type: Number, required: true, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// "One pending invitation per `(orgId, email)`" rule. Partial unique
// index targets only pending rows — accepted/cancelled/expired rows for
// the same email do not block re-invitation.
organizationInvitationSchema.index(
  { organizationId: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" },
  },
);

organizationInvitationSchema.index({ tokenHash: 1 }, { unique: true });

export const OrganizationInvitationModel = model(
  "OrganizationInvitation",
  organizationInvitationSchema,
);
