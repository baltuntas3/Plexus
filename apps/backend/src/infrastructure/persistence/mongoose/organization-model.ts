import { Schema, model } from "mongoose";

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
    // Optimistic-concurrency token bumped on every successful save.
    revision: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

organizationSchema.index({ slug: 1 }, { unique: true });

export const OrganizationModel = model("Organization", organizationSchema);
