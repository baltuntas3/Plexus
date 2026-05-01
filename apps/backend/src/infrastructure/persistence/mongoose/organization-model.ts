import { Schema, model } from "mongoose";

// Embedded policy subdocument. `_id: false` because the policy is value-
// shaped, not entity-shaped: identity is the parent org's `_id`, not a
// separate row id. `requiredApprovals` range (1..10) is enforced inside
// the `Organization` aggregate; the schema is intentionally permissive.
const approvalPolicySchema = new Schema(
  { requiredApprovals: { type: Number, required: true } },
  { _id: false },
);

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // URL-friendly identifier. Globally unique — the `RegisterOrganization`
    // use case checks `findBySlug` before persisting so callers get an
    // explicit error instead of a duplicate-key surface, but the unique
    // index is the last line of defense against a concurrent register race.
    slug: { type: String, required: true, unique: true, lowercase: true },
    // Mirrors the `OrganizationMember.role="owner"` row's userId. Updated
    // atomically with the member rows in the `TransferOwnership` use case.
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // Production-promotion gate. `null` = no policy, `→ production` flows
    // through `prompt:promote` directly. When set, those promotions are
    // routed through the `VersionApprovalRequest` workflow.
    approvalPolicy: { type: approvalPolicySchema, default: null },
    // Optimistic-concurrency token bumped on every successful save.
    revision: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

export const OrganizationModel = model("Organization", organizationSchema);
