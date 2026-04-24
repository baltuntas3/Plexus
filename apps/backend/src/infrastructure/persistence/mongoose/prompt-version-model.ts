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
    // Lineage pointer. Null for the first version of a prompt; set to the
    // source version's id when a new version is forked from an edit. Keeps
    // BenchmarkResult → PromptVersion links deterministic because versions
    // are immutable: an old row always resolves to the content it evaluated.
    parentVersionId: {
      type: Schema.Types.ObjectId,
      ref: "PromptVersion",
      default: null,
    },
    sourcePrompt: { type: String, required: true },
    representation: {
      type: representationSchema,
      required: true,
      default: () => ({ kind: "classical", graph: null, generatorModel: null }),
    },
    status: { type: String, required: true, enum: VERSION_STATUSES, default: "draft" },
  },
  { timestamps: true },
);

promptVersionSchema.index({ promptId: 1, version: 1 }, { unique: true });
promptVersionSchema.index({ promptId: 1, status: 1 });
promptVersionSchema.index({ promptId: 1, createdAt: -1 });

export const PromptVersionModel = model("PromptVersion", promptVersionSchema);
