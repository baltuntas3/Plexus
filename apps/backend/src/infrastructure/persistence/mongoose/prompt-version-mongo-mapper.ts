import type { Types } from "mongoose";
import type {
  PromptRepresentationPrimitives,
  PromptVersionPrimitives,
} from "../../../domain/entities/prompt-version.js";
import type { PromptVersionSummary } from "../../../application/queries/prompt-query-service.js";
import type {
  BraidAuthorshipDto,
  BraidGraphLayoutDto,
} from "@plexus/shared-types";

// Shared Mongo ↔ Domain conversions for PromptVersion. Centralising these
// keeps the aggregate write-repo, the read-side query service, and any
// future read projection in lock-step when the schema changes.

interface AuthorshipDoc {
  kind: "model" | "manual";
  model?: string | null;
  derivedFromModel?: string | null;
}

interface VariableDoc {
  name: string;
  description?: string | null;
  defaultValue?: string | null;
  required?: boolean;
}

export interface PromptVersionDocShape {
  _id: Types.ObjectId;
  promptId: Types.ObjectId;
  organizationId: Types.ObjectId;
  version: string;
  name: string | null;
  parentVersionId: Types.ObjectId | null;
  sourcePrompt: string;
  representation: {
    kind: "classical" | "braid";
    graph: string | null;
    authorship: AuthorshipDoc | null;
  };
  variables?: VariableDoc[];
  // Visual-editor positions persisted via `setBraidGraphLayout`.
  // Optional / nullable: rows pre-dating layout persistence have no
  // entry, and even rows with a graph may not have positions yet
  // (user hasn't dragged anything).
  braidGraphLayout?: BraidGraphLayoutDto | null;
  status: PromptVersionPrimitives["status"];
  revision?: number;
  createdAt: Date;
  updatedAt: Date;
}

const hydrateAuthorship = (
  doc: PromptVersionDocShape["representation"],
): PromptRepresentationPrimitives => {
  if (doc.kind !== "braid" || !doc.graph || !doc.authorship) {
    return { kind: "classical" };
  }
  if (doc.authorship.kind === "model" && doc.authorship.model) {
    return {
      kind: "braid",
      graph: doc.graph,
      authorship: { kind: "model", model: doc.authorship.model },
    };
  }
  if (doc.authorship.kind === "manual") {
    return {
      kind: "braid",
      graph: doc.graph,
      authorship: {
        kind: "manual",
        derivedFromModel: doc.authorship.derivedFromModel ?? null,
      },
    };
  }
  return { kind: "classical" };
};

const hydrateVariables = (
  docs: VariableDoc[] | undefined,
): PromptVersionPrimitives["variables"] => {
  if (!docs || docs.length === 0) return [];
  return docs.map((d) => ({
    name: d.name,
    description: d.description ?? null,
    defaultValue: d.defaultValue ?? null,
    required: d.required ?? false,
  }));
};

export const toVersionPrimitives = (
  doc: PromptVersionDocShape,
): PromptVersionPrimitives => ({
  id: String(doc._id),
  promptId: String(doc.promptId),
  organizationId: String(doc.organizationId),
  version: doc.version,
  name: doc.name ?? null,
  parentVersionId: doc.parentVersionId ? String(doc.parentVersionId) : null,
  sourcePrompt: doc.sourcePrompt,
  representation: hydrateAuthorship(doc.representation),
  variables: hydrateVariables(doc.variables),
  braidGraphLayout: doc.braidGraphLayout ?? null,
  status: doc.status,
  revision: doc.revision ?? 0,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

const toAuthorshipDto = (
  repr: PromptRepresentationPrimitives,
): BraidAuthorshipDto | null => {
  if (repr.kind !== "braid") return null;
  if (repr.authorship.kind === "model") {
    return { kind: "model", model: repr.authorship.model };
  }
  return { kind: "manual", derivedFromModel: repr.authorship.derivedFromModel };
};

// Read projection. `executablePrompt` is pre-resolved (braid graph when
// present, otherwise the classical source) so benchmark callers can build
// evaluation prompts without caring about representation discrimination.
export const toVersionSummary = (
  doc: PromptVersionDocShape,
): PromptVersionSummary => {
  const representation = hydrateAuthorship(doc.representation);
  const braidGraph = representation.kind === "braid" ? representation.graph : null;
  const authorship = toAuthorshipDto(representation);
  const generatorModel =
    authorship?.kind === "model"
      ? authorship.model
      : authorship?.kind === "manual"
      ? authorship.derivedFromModel
      : null;
  return {
    id: String(doc._id),
    promptId: String(doc.promptId),
    version: doc.version,
    name: doc.name ?? null,
    parentVersionId: doc.parentVersionId ? String(doc.parentVersionId) : null,
    sourcePrompt: doc.sourcePrompt,
    braidGraph,
    braidGraphLayout: doc.braidGraphLayout ?? null,
    braidAuthorship: authorship,
    generatorModel,
    variables: hydrateVariables(doc.variables),
    executablePrompt: braidGraph ?? doc.sourcePrompt,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

export const toVersionDocSet = (
  version: PromptVersionPrimitives,
): Record<string, unknown> => ({
  promptId: version.promptId,
  organizationId: version.organizationId,
  version: version.version,
  name: version.name,
  parentVersionId: version.parentVersionId,
  sourcePrompt: version.sourcePrompt,
  representation:
    version.representation.kind === "braid"
      ? {
          kind: "braid",
          graph: version.representation.graph,
          authorship: version.representation.authorship,
        }
      : { kind: "classical", graph: null, authorship: null },
  variables: version.variables.map((v) => ({
    name: v.name,
    description: v.description,
    defaultValue: v.defaultValue,
    required: v.required,
  })),
  braidGraphLayout: version.braidGraphLayout,
  status: version.status,
  revision: version.revision,
  createdAt: version.createdAt,
  updatedAt: version.updatedAt,
});
