import { Schema, model } from "mongoose";
import {
  MEMBERSHIP_EVENT_TYPES,
  ORGANIZATION_ROLES,
} from "@plexus/shared-types";

const organizationMembershipEventSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    eventType: { type: String, required: true, enum: MEMBERSHIP_EVENT_TYPES },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    targetUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    targetEmail: { type: String, default: null },
    oldRole: { type: String, enum: ORGANIZATION_ROLES, default: null },
    newRole: { type: String, enum: ORGANIZATION_ROLES, default: null },
    occurredAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

// Listing is always reverse-chronological per org (UI timeline). Compound
// index serves both that query path and per-target lookups (`who changed
// what about user X` → filter by organizationId + targetUserId).
organizationMembershipEventSchema.index({ organizationId: 1, occurredAt: -1 });
organizationMembershipEventSchema.index({
  organizationId: 1,
  targetUserId: 1,
  occurredAt: -1,
});

export const OrganizationMembershipEventModel = model(
  "OrganizationMembershipEvent",
  organizationMembershipEventSchema,
);
