import type { VersionStatus } from "@plexus/shared-types";
import { PromptSourceEmptyError } from "../errors/domain-error.js";
import {
  BraidAuthorship,
  type BraidAuthorshipSnapshot,
} from "../value-objects/braid-authorship.js";
import { BraidGraph } from "../value-objects/braid-graph.js";
import { VersionLabel } from "../value-objects/version-label.js";

// PromptVersion is an immutable content artifact.
//
// Once a version is written, its `sourcePrompt` and `representation` (braid
// graph + generator model) never change. Any "edit" to a braid — manual
// mermaid tweak, regenerate, or chat refinement — produces a *new* version
// linked via `parentVersionId`. This preserves audit trail: a BenchmarkResult
// referencing a version id always resolves to the exact content that was
// evaluated, not whatever the content has been mutated to since.
//
// Only metadata mutates in place: `name` (user-facing label) and `status`
// (workflow: draft / staging / production). Status transitions are managed
// by the Prompt aggregate root via the symbol-keyed mutator.

export interface ClassicalPromptRepresentationPrimitives {
  kind: "classical";
}

export interface BraidPromptRepresentationPrimitives {
  kind: "braid";
  graph: string;
  authorship: BraidAuthorshipSnapshot;
}

export type PromptRepresentationPrimitives =
  | ClassicalPromptRepresentationPrimitives
  | BraidPromptRepresentationPrimitives;

export interface PromptVersionPrimitives {
  id: string;
  promptId: string;
  version: string;
  name: string | null;
  parentVersionId: string | null;
  sourcePrompt: string;
  representation: PromptRepresentationPrimitives;
  status: VersionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePromptVersionParams {
  id: string;
  promptId: string;
  version: VersionLabel;
  sourcePrompt: string;
  name?: string | null;
  parentVersionId?: string | null;
  // When present, the version is born as a braid (fork-on-edit path). When
  // absent, the new version starts classical and a follow-up edit — which
  // is itself a fork — is required to attach a braid. Authorship is a VO
  // rather than a bare model string so manual edits do not masquerade as
  // LLM-generated content.
  initialBraid?: { graph: BraidGraph; authorship: BraidAuthorship };
  createdAt?: Date;
  updatedAt?: Date;
}

export class ClassicalPromptRepresentation {
  readonly kind = "classical";

  toPrimitives(): ClassicalPromptRepresentationPrimitives {
    return { kind: this.kind };
  }
}

export class BraidPromptRepresentation {
  readonly kind = "braid";

  constructor(
    public readonly graph: BraidGraph,
    public readonly authorship: BraidAuthorship,
  ) {}

  get executablePrompt(): string {
    return this.graph.mermaidCode;
  }

  toPrimitives(): BraidPromptRepresentationPrimitives {
    return {
      kind: this.kind,
      graph: this.graph.mermaidCode,
      authorship: this.authorship.toSnapshot(),
    };
  }
}

export type PromptRepresentation = ClassicalPromptRepresentation | BraidPromptRepresentation;

interface InternalState {
  id: string;
  promptId: string;
  version: VersionLabel;
  name: string | null;
  parentVersionId: string | null;
  sourcePrompt: string;
  representation: PromptRepresentation;
  status: VersionStatus;
  createdAt: Date;
  updatedAt: Date;
}

// Symbol-keyed gateway to the child's metadata mutators. Content mutation
// (braid graph, source prompt) does not live here — edits fork a new
// version via Prompt.upsertBraid, they do not rewrite in place. Only
// `name` (label) and `status` (workflow) change on an existing version.
//
// The `unique symbol` type annotation is what makes the class computed-key
// property resolve: without it TS widens to `symbol` and refuses to index.
export const PromptVersionInternal: unique symbol = Symbol(
  "PromptVersion#internal-mutator",
);

export interface PromptVersionMutator {
  rename(name: string | null): void;
  changeStatus(status: VersionStatus): void;
}

export class PromptVersion {
  readonly [PromptVersionInternal]: PromptVersionMutator;

  private constructor(private state: InternalState) {
    this[PromptVersionInternal] = {
      rename: (name) => {
        this.state = {
          ...this.state,
          name: normalizeVersionName(name),
          updatedAt: new Date(),
        };
      },
      changeStatus: (status) => {
        this.state = { ...this.state, status, updatedAt: new Date() };
      },
    };
  }

  static create(params: CreatePromptVersionParams): PromptVersion {
    const now = params.createdAt ?? new Date();
    const representation: PromptRepresentation = params.initialBraid
      ? new BraidPromptRepresentation(
          params.initialBraid.graph,
          params.initialBraid.authorship,
        )
      : new ClassicalPromptRepresentation();
    return new PromptVersion({
      id: params.id,
      promptId: params.promptId,
      version: params.version,
      name: normalizeVersionName(params.name ?? null),
      parentVersionId: params.parentVersionId ?? null,
      sourcePrompt: normalizeSourcePrompt(params.sourcePrompt),
      representation,
      status: "draft",
      createdAt: now,
      updatedAt: params.updatedAt ?? now,
    });
  }

  static hydrate(primitives: PromptVersionPrimitives): PromptVersion {
    return new PromptVersion({
      id: primitives.id,
      promptId: primitives.promptId,
      // Parse at the persistence boundary: a malformed label in the store
      // surfaces as a domain error here instead of silently flowing through
      // the rest of the aggregate as an unchecked string.
      version: VersionLabel.parse(primitives.version),
      name: normalizeVersionName(primitives.name),
      parentVersionId: primitives.parentVersionId ?? null,
      // Persisted content was already validated at creation time; trust it.
      sourcePrompt: primitives.sourcePrompt,
      representation: hydrateRepresentation(primitives.representation),
      status: primitives.status,
      createdAt: primitives.createdAt,
      updatedAt: primitives.updatedAt,
    });
  }

  get id(): string {
    return this.state.id;
  }

  get promptId(): string {
    return this.state.promptId;
  }

  // Exposed as a string for external callers (controllers, mappers). The
  // internal state carries the VersionLabel VO so the "v{n}" invariant is
  // checked at exactly one place (creation / parse).
  get version(): string {
    return this.state.version.toString();
  }

  // Typed accessor for aggregate-internal comparisons (Prompt.promoteVersion
  // uses this to check productionVersion equality without stringifying).
  get versionLabel(): VersionLabel {
    return this.state.version;
  }

  get name(): string | null {
    return this.state.name;
  }

  get parentVersionId(): string | null {
    return this.state.parentVersionId;
  }

  get sourcePrompt(): string {
    return this.state.sourcePrompt;
  }

  get braidGraph(): BraidGraph | null {
    return this.state.representation.kind === "braid" ? this.state.representation.graph : null;
  }

  // Typed provenance accessor. Null for classical versions; a BraidAuthorship
  // VO for braid versions so consumers that care about "was this LLM-made
  // or hand-edited?" can branch on kind.
  get braidAuthorship(): BraidAuthorship | null {
    return this.state.representation.kind === "braid"
      ? this.state.representation.authorship
      : null;
  }

  // Legacy convenience getter preserved for DTO/display paths. Returns the
  // model that actually ran for "model" authorship and the derivedFromModel
  // for "manual" authorship (null if unknown). Use `braidAuthorship` when
  // the distinction matters for correctness (audit, filtering, scoring).
  get generatorModel(): string | null {
    return this.state.representation.kind === "braid"
      ? this.state.representation.authorship.displayModel
      : null;
  }

  get hasBraidRepresentation(): boolean {
    return this.state.representation.kind === "braid";
  }

  get executablePrompt(): string {
    return this.state.representation.kind === "braid"
      ? this.state.representation.graph.mermaidCode
      : this.state.sourcePrompt;
  }

  get status(): VersionStatus {
    return this.state.status;
  }

  get createdAt(): Date {
    return this.state.createdAt;
  }

  get updatedAt(): Date {
    return this.state.updatedAt;
  }

  toPrimitives(): PromptVersionPrimitives {
    return {
      id: this.state.id,
      promptId: this.state.promptId,
      version: this.state.version.toString(),
      name: this.state.name,
      parentVersionId: this.state.parentVersionId,
      sourcePrompt: this.state.sourcePrompt,
      representation: this.state.representation.toPrimitives(),
      status: this.state.status,
      createdAt: this.state.createdAt,
      updatedAt: this.state.updatedAt,
    };
  }
}

const normalizeSourcePrompt = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw PromptSourceEmptyError();
  }
  return trimmed;
};

const normalizeVersionName = (name: string | null): string | null => {
  const trimmed = name?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

const hydrateRepresentation = (
  representation: PromptRepresentationPrimitives,
): PromptRepresentation => {
  if (representation.kind === "classical") {
    return new ClassicalPromptRepresentation();
  }
  return new BraidPromptRepresentation(
    BraidGraph.parse(representation.graph),
    BraidAuthorship.fromSnapshot(representation.authorship),
  );
};
