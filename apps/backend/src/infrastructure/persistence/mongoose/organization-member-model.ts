import { Schema, model } from "mongoose";
import { ORGANIZATION_ROLES } from "@plexus/shared-types";

const organizationMemberSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, required: true, enum: ORGANIZATION_ROLES },
    // The userId of the inviter. Null for the founding owner of an org
    // (no inviter exists at registration time).
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    joinedAt: { type: Date, required: true, default: () => new Date() },
    revision: { type: Number, required: true, default: 0 },
  },
  { timestamps: false },
);

// Unique pairing — the authorization layer relies on this row being
// unique per (org, user) so a `findByOrganizationAndUser` lookup is O(1).
organizationMemberSchema.index({ organizationId: 1, userId: 1 }, { unique: true });

export const OrganizationMemberModel = model(
  "OrganizationMember",
  organizationMemberSchema,
);
