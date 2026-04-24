import { Schema, model } from "mongoose";
import { TASK_TYPES } from "@plexus/shared-types";

const promptSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    taskType: { type: String, required: true, enum: TASK_TYPES },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Canonical reference to the version currently serving production
    // traffic. Label-based display ("v2") is a read-side concern the
    // query service resolves via a lookup.
    productionVersionId: {
      type: Schema.Types.ObjectId,
      ref: "PromptVersion",
      default: null,
    },
    // Monotonic source of truth for version label allocation. Advanced on
    // every new version so labels remain unique even after a delete —
    // decoupled from the live version count.
    versionCounter: { type: Number, required: true, default: 0 },
    // Optimistic-concurrency token bumped on every successful save.
    revision: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

promptSchema.index({ ownerId: 1, createdAt: -1 });
promptSchema.index({ ownerId: 1, name: "text", description: "text" });

export const PromptModel = model("Prompt", promptSchema);
