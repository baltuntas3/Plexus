import { Schema, model } from "mongoose";
import { TASK_TYPES } from "@plexus/shared-types";

const promptSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    taskType: { type: String, required: true, enum: TASK_TYPES },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    productionVersion: { type: String, default: null },
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
