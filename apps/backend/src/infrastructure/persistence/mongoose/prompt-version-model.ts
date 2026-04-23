import { Schema, model } from "mongoose";
import { VERSION_STATUSES } from "@plexus/shared-types";

const representationSchema = new Schema(
  {
    kind: { type: String, required: true, enum: ["classical", "braid"] },
    graph: { type: String, default: null },
    generatorModel: { type: String, default: null },
  },
  { _id: false },
);

const promptVersionSchema = new Schema(
  {
    promptId: { type: Schema.Types.ObjectId, ref: "Prompt", required: true, index: true },
    version: { type: String, required: true },
    name: { type: String, default: null },
    sourcePrompt: { type: String, required: true },
    representation: {
      type: representationSchema,
      required: true,
      default: () => ({ kind: "classical", graph: null, generatorModel: null }),
    },
    solverModel: { type: String, default: null },
    status: { type: String, required: true, enum: VERSION_STATUSES, default: "draft" },
  },
  { timestamps: true },
);

promptVersionSchema.index({ promptId: 1, version: 1 }, { unique: true });
promptVersionSchema.index({ promptId: 1, status: 1 });
promptVersionSchema.index({ promptId: 1, createdAt: -1 });

export const PromptVersionModel = model("PromptVersion", promptVersionSchema);
