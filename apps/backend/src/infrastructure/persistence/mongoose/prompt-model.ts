import { Schema, model } from "mongoose";
import { TASK_TYPES } from "@plexus/shared-types";

const promptSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    taskType: { type: String, required: true, enum: TASK_TYPES },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    productionVersion: { type: String, default: null },
    // Monotonic source of truth for version label allocation. Advanced on
    // every new version so labels remain unique even after a version is
    // deleted — decoupled from the live versions count.
    versionCounter: { type: Number, required: true, default: 0 },
    // Optimistic-concurrency token bumped by the aggregate repository on each
    // successful save. Filtering by this on update guarantees lost-update
    // detection for concurrent writers that loaded the same aggregate.
    revision: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

promptSchema.index({ ownerId: 1, createdAt: -1 });
promptSchema.index({ ownerId: 1, name: "text", description: "text" });

export const PromptModel = model("Prompt", promptSchema);
