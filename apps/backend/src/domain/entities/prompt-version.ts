import type { VersionStatus } from "@plexus/shared-types";
import {
  PromptInvalidVersionTransitionError,
  PromptSourceEmptyError,
} from "../errors/domain-error.js";
import {
  BraidAuthorship,
  type BraidAuthorshipSnapshot,
} from "../value-objects/braid-authorship.js";
import { BraidGraph } from "../value-objects/braid-graph.js";
import {
  PromptVariable,
  type PromptVariableSnapshot,
  assertUniqueVariableNames,
} from "../value-objects/prompt-variable.js";
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
  // Template variable definitions for this version. Body and braid node
  // labels reference them via `{{name}}`. Reference→definition integrity is
  // enforced by use cases (cross-field rule), not in the aggregate, so the
  // domain stays free of body parsing concerns.
  variables: PromptVariableSnapshot[];
  status: VersionStatus;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PromptVersionSnapshot {
  readonly primitives: PromptVersionPrimitives;
  readonly expectedRevision: number;
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
  variables?: readonly PromptVariable[];
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

// Internal state shape mirrors `PromptVersionPrimitives` exactly except for
// `representation` (parsed class instance so getters like `braidGraph` return
// the VO without re-parsing) and `variables` (VO list so callers see typed
// instances rather than raw snapshot data).
type InternalState = Omit<PromptVersionPrimitives, "representation" | "variables"> & {
  representation: PromptRepresentation;
  variables: PromptVariable[];
};

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
    const variables = [...(params.variables ?? [])];
    assertUniqueVariableNames(variables);
    return new PromptVersion({
      id: params.id,
      promptId: params.promptId,
      version: params.version.toString(),
      name: normalizeVersionName(params.name ?? null),
      parentVersionId: params.parentVersionId ?? null,
      sourcePrompt: normalizeSourcePrompt(params.sourcePrompt),
      representation,
      variables,
      status: "draft",
      revision: 0,
      createdAt: now,
      updatedAt: params.updatedAt ?? now,
    });
  }

  static hydrate(primitives: PromptVersionPrimitives): PromptVersion {
    // Validate at the persistence boundary: a malformed label in the store
    // surfaces as a domain error here instead of silently flowing through.
    // The parsed VO is discarded — internal state keeps the canonical string.
    VersionLabel.parse(primitives.version);
    const variables = primitives.variables.map(PromptVariable.fromSnapshot);
    assertUniqueVariableNames(variables);
    return new PromptVersion({
      id: primitives.id,
      promptId: primitives.promptId,
      version: primitives.version,
      name: normalizeVersionName(primitives.name),
      parentVersionId: primitives.parentVersionId ?? null,
      sourcePrompt: primitives.sourcePrompt,
      representation: hydrateRepresentation(primitives.representation),
      variables,
      status: primitives.status,
      revision: primitives.revision,
      createdAt: primitives.createdAt,
      updatedAt: primitives.updatedAt,
    });
  }

  // Fork with a new id and label — the content is either carried from the
  // source (classical) or replaced with a new braid. `parentVersionId` is
  // set from the source so lineage is preserved. Variables also default to
  // the source's set; callers can override with `variables` to add/remove.
  static fork(params: {
    source: PromptVersion;
    newId: string;
    newLabel: VersionLabel;
    sourcePrompt?: string;
    name?: string | null;
    initialBraid?: { graph: BraidGraph; authorship: BraidAuthorship };
    variables?: readonly PromptVariable[];
  }): PromptVersion {
    return PromptVersion.create({
      id: params.newId,
      promptId: params.source.promptId,
      version: params.newLabel,
      sourcePrompt: params.sourcePrompt ?? params.source.sourcePrompt,
      name: params.name ?? null,
      parentVersionId: params.source.id,
      initialBraid: params.initialBraid,
      variables: params.variables ?? params.source.variables,
    });
  }

  get id(): string {
    return this.state.id;
  }

  get promptId(): string {
    return this.state.promptId;
  }

  get version(): string {
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

  get variables(): readonly PromptVariable[] {
    return this.state.variables;
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
      ...this.state,
      representation: this.state.representation.toPrimitives(),
      variables: this.state.variables.map((v) => v.toSnapshot()),
    };
  }

  toSnapshot(): PromptVersionSnapshot {
    const expectedRevision = this.state.revision;
    return {
      primitives: { ...this.toPrimitives(), revision: expectedRevision + 1 },
      expectedRevision,
    };
  }

  markPersisted(): void {
    this.state = { ...this.state, revision: this.state.revision + 1 };
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
