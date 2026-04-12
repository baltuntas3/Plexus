import { Schema, model } from "mongoose";
import { TASK_TYPES } from "@plexus/shared-types";

const testCaseSchema = new Schema(
  {
    input: { type: String, required: true },
    expectedOutput: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: true },
);

const datasetSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    taskType: { type: String, required: true, enum: TASK_TYPES },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    testCases: { type: [testCaseSchema], default: [] },
  },
  { timestamps: true },
);

datasetSchema.index({ ownerId: 1, createdAt: -1 });
datasetSchema.index({ ownerId: 1, name: "text", description: "text" });

export const DatasetModel = model("Dataset", datasetSchema);
