import type { Types } from "mongoose";
import type {
  PromptRepresentationPrimitives,
  PromptVersionPrimitives,
} from "../../../domain/entities/prompt-version.js";
import type { PromptVersionSummary } from "../../../application/queries/prompt-query-service.js";
import type {
  BraidAuthorshipDto,
} from "@plexus/shared-types";

// Shared Mongo ↔ Domain conversions for PromptVersion. Centralising these
// keeps the aggregate write-repo, the read-side query service, and any
// future read projection in lock-step when the schema changes.

interface AuthorshipDoc {
  kind: "model" | "manual";
  model?: string | null;
  derivedFromModel?: string | null;
}

export interface PromptVersionDocShape {
  _id: Types.ObjectId;
  promptId: Types.ObjectId;
  version: string;
  name: string | null;
  parentVersionId: Types.ObjectId | null;
  sourcePrompt: string;
  representation: {
    kind: "classical" | "braid";
    graph: string | null;
    authorship: AuthorshipDoc | null;
    // Legacy field from pre-authorship schema. Only consulted when
    // `authorship` is missing so old documents still hydrate correctly.
    generatorModel?: string | null;
  };
  status: PromptVersionPrimitives["status"];
  revision?: number;
  createdAt: Date;
  updatedAt: Date;
}

const hydrateAuthorship = (
  doc: PromptVersionDocShape["representation"],
): PromptRepresentationPrimitives => {
  if (doc.kind !== "braid" || !doc.graph) {
    return { kind: "classical" };
  }
  if (doc.authorship) {
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
  }
  // Pre-authorship schema: infer "model" from the legacy flat field. Older
  // rows were all LLM-generated since manual provenance didn't exist yet.
  if (doc.generatorModel) {
    return {
      kind: "braid",
      graph: doc.graph,
      authorship: { kind: "model", model: doc.generatorModel },
    };
  }
  // Malformed: treat as classical rather than fabricate a provenance.
  return { kind: "classical" };
};

export const toVersionPrimitives = (
  doc: PromptVersionDocShape,
): PromptVersionPrimitives => ({
  id: String(doc._id),
  promptId: String(doc.promptId),
  version: doc.version,
  name: doc.name ?? null,
  parentVersionId: doc.parentVersionId ? String(doc.parentVersionId) : null,
  sourcePrompt: doc.sourcePrompt,
  representation: hydrateAuthorship(doc.representation),
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
    braidAuthorship: authorship,
    generatorModel,
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
  status: version.status,
  revision: version.revision,
  createdAt: version.createdAt,
  updatedAt: version.updatedAt,
});
