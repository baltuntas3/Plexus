import { Schema, model } from "mongoose";
import { VERSION_STATUSES } from "@plexus/shared-types";

const authorshipSchema = new Schema(
  {
    kind: { type: String, required: true, enum: ["model", "manual"] },
    model: { type: String, default: null },
    derivedFromModel: { type: String, default: null },
  },
  { _id: false },
);

const representationSchema = new Schema(
  {
    kind: { type: String, required: true, enum: ["classical", "braid"] },
    graph: { type: String, default: null },
    // Discriminated provenance for braid representations. Classical versions
    // persist `null` here.
    authorship: { type: authorshipSchema, default: null },
  },
  { _id: false },
);

const variableSchema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: null },
    defaultValue: { type: String, default: null },
    required: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

// Visual-editor node positions. Domain VO `BraidGraphLayout` validates
// nodeId regex + finite x/y; the schema is intentionally permissive so
// validation errors surface as 400 from the use-case boundary rather
// than as a Mongoose CastError.
const nodePositionSchema = new Schema(
  {
    nodeId: { type: String, required: true },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
  },
  { _id: false },
);

const braidGraphLayoutSchema = new Schema(
  {
    positions: { type: [nodePositionSchema], required: true, default: [] },
  },
  { _id: false },
);

const promptVersionSchema = new Schema(
  {
    promptId: { type: Schema.Types.ObjectId, ref: "Prompt", required: true, index: true },
    // Denormalised owner from the parent Prompt — versions inherit it at
    // create/fork time and never mutate it. Repository reads filter on
    // this directly so cross-tenant lookups are rejected without joining
    // through Prompt (defense-in-depth).
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
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
      default: () => ({ kind: "classical", graph: null, authorship: null }),
    },
    // Template variable definitions. Body and braid node labels reference
    // them via `{{name}}`; SDK passes values at runtime for substitution.
    variables: { type: [variableSchema], required: true, default: [] },
    // Visual-editor positions. Mutated in place via the layout
    // endpoint (no fork): layout is presentation metadata, not
    // graph identity.
    braidGraphLayout: { type: braidGraphLayoutSchema, default: null },
    status: { type: String, required: true, enum: VERSION_STATUSES, default: "draft" },
    // Optimistic-concurrency token. Bumped by the PromptVersion repo on
    // each successful save so concurrent writers to the same version
    // (rename races, concurrent promote flows) are caught instead of
    // silently overwriting.
    revision: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

promptVersionSchema.index({ promptId: 1, version: 1 }, { unique: true });
promptVersionSchema.index({ promptId: 1, status: 1 });
promptVersionSchema.index({ promptId: 1, createdAt: -1 });
// Org-scoped read paths use this index when filtering versions across an
// org (e.g. cross-prompt lookups during benchmark seeding).
promptVersionSchema.index({ organizationId: 1, createdAt: -1 });

export const PromptVersionModel = model("PromptVersion", promptVersionSchema);
