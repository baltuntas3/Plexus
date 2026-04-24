import type { VersionStatus } from "@plexus/shared-types";
import {
  PromptInvalidVersionTransitionError,
  PromptSourceEmptyError,
  ValidationError,
} from "../errors/domain-error.js";
import {
  BraidAuthorship,
  type BraidAuthorshipSnapshot,
} from "../value-objects/braid-authorship.js";
import { BraidGraph } from "../value-objects/braid-graph.js";
import { VersionLabel } from "../value-objects/version-label.js";

// PromptVersion is its own aggregate root.
//
// Content (sourcePrompt, representation) is immutable — every graph edit is
// a fork that creates a new version with its own id, never a rewrite. This
// keeps BenchmarkResult → PromptVersion links stable: an old row always
// resolves to the exact content that was evaluated, not whatever the
// content has been mutated to since.
//
// Only metadata mutates in place: `name` (user-facing label) and `status`
// (workflow: draft / staging / production). The "one production per prompt"
// invariant is held by the Prompt root (productionVersionId); the version's
// own `status` is the user-facing workflow state that a promote orchestrates
// across the two aggregates.

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
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PromptVersionSnapshot {
  readonly state: PromptVersionPrimitives;
  readonly expectedRevision: number;
  readonly nextRevision: number;
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
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export class PromptVersion {
  private constructor(private state: InternalState) {}

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
      revision: 0,
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
      revision: primitives.revision,
      createdAt: primitives.createdAt,
      updatedAt: primitives.updatedAt,
    });
  }

  // Fork with a new id and label — the content is either carried from the
  // source (classical) or replaced with a new braid. `parentVersionId` is
  // set from the source so lineage is preserved.
  static fork(params: {
    source: PromptVersion;
    newId: string;
    newLabel: VersionLabel;
    sourcePrompt?: string;
    name?: string | null;
    initialBraid?: { graph: BraidGraph; authorship: BraidAuthorship };
  }): PromptVersion {
    return PromptVersion.create({
      id: params.newId,
      promptId: params.source.promptId,
      version: params.newLabel,
      sourcePrompt: params.sourcePrompt ?? params.source.sourcePrompt,
      name: params.name ?? null,
      parentVersionId: params.source.id,
      initialBraid: params.initialBraid,
    });
  }

  get id(): string {
    return this.state.id;
  }

  get promptId(): string {
    return this.state.promptId;
  }

  get version(): string {
    return this.state.version.toString();
  }

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

  get braidAuthorship(): BraidAuthorship | null {
    return this.state.representation.kind === "braid"
      ? this.state.representation.authorship
      : null;
  }

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

  get revision(): number {
    return this.state.revision;
  }

  get createdAt(): Date {
    return this.state.createdAt;
  }

  get updatedAt(): Date {
    return this.state.updatedAt;
  }

  rename(name: string | null): void {
    this.state = {
      ...this.state,
      name: normalizeVersionName(name),
      updatedAt: new Date(),
    };
  }

  // Status transition rule: draft is the initial working state and cannot
  // be re-entered. Cross-aggregate invariants (one production per prompt)
  // are orchestrated by the PromoteVersion use case on the Prompt root;
  // this method only guards the intra-aggregate transition rule.
  changeStatus(status: VersionStatus): void {
    if (status === "draft") {
      throw PromptInvalidVersionTransitionError(this.state.status, "draft");
    }
    if (this.state.status === status) return;
    this.state = { ...this.state, status, updatedAt: new Date() };
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
      revision: this.state.revision,
      createdAt: this.state.createdAt,
      updatedAt: this.state.updatedAt,
    };
  }

  toSnapshot(): PromptVersionSnapshot {
    const expectedRevision = this.state.revision;
    const nextRevision = expectedRevision + 1;
    return {
      state: { ...this.toPrimitives(), revision: nextRevision },
      expectedRevision,
      nextRevision,
    };
  }

  commit(snapshot: PromptVersionSnapshot): void {
    if (snapshot.expectedRevision !== this.state.revision) {
      throw ValidationError(
        "Cannot commit a stale PromptVersion snapshot: revision advanced since the snapshot was taken",
      );
    }
    this.state = { ...this.state, revision: snapshot.nextRevision };
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
