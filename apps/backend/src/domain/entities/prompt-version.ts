import type { BraidGraphLayoutDto, VersionStatus } from "@plexus/shared-types";
import {
  PromptInvalidVersionTransitionError,
  PromptSourceEmptyError,
} from "../errors/domain-error.js";
import {
  BraidAuthorship,
  type BraidAuthorshipSnapshot,
} from "../value-objects/braid-authorship.js";
import { BraidGraph } from "../value-objects/braid-graph.js";
import { BraidGraphLayout } from "../value-objects/braid-graph-layout.js";
import {
  PromptVariable,
  type PromptVariableSnapshot,
  assertUniqueVariableNames,
} from "../value-objects/prompt-variable.js";
import { VersionLabel } from "../value-objects/version-label.js";

// PromptVersion is its own aggregate root.
//
// Content (sourcePrompt, braid graph) is immutable — every graph edit is a
// fork that creates a new version with its own id, never a rewrite. This
// keeps BenchmarkResult → PromptVersion links stable: an old row always
// resolves to the exact content that was evaluated, not whatever the
// content has been mutated to since.
//
// Three fields mutate in place:
//   • `name` (user-facing label).
//   • `status` (workflow: draft / development / staging / production —
//     `draft` is the initial state and cannot be re-entered). The
//     "one production per prompt" invariant is held by the Prompt
//     root (productionVersionId); the version's own `status` is the
//     user-facing workflow state that a promote orchestrates across
//     the two aggregates.
//   • `braidGraphLayout` (visual-editor node positions). Layout is
//     *presentation metadata* — dragging a node doesn't change graph
//     identity (nodes/edges/labels), so saving the layout doesn't
//     fork. Structural edits (add/remove node, rename, …) still fork
//     and the new version starts with no saved layout.

// Persistence-shape discriminated union. The mongo mapper round-trips
// through this contract; internally the aggregate stores a nullable braid
// VO pair (`BraidContent | null`) instead.
interface ClassicalPromptRepresentationPrimitives {
  kind: "classical";
}

interface BraidPromptRepresentationPrimitives {
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
  // Owning organization, denormalised from the parent Prompt root. Stored
  // on every version doc so repository queries can filter by `organizationId`
  // directly (defense-in-depth) instead of joining through Prompt — the
  // version repo's port now refuses to return a row that isn't scoped to the
  // caller's tenant. Set at create time and inherited on fork; never mutated.
  organizationId: string;
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
  // Visual-editor positions. Null = no saved layout (auto-layout in
  // the frontend). Mutated in place via `setBraidGraphLayout`; layout
  // is presentation metadata and does NOT fork the aggregate even
  // though structural edits do.
  braidGraphLayout: BraidGraphLayoutDto | null;
  status: VersionStatus;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

interface PromptVersionSnapshot {
  readonly primitives: PromptVersionPrimitives;
  readonly expectedRevision: number;
}

interface CreatePromptVersionParams {
  id: string;
  promptId: string;
  organizationId: string;
  version: VersionLabel;
  sourcePrompt: string;
  name?: string | null;
  parentVersionId?: string | null;
  // When present, the version is born as a braid (fork-on-edit path). When
  // absent, the new version starts classical and a follow-up edit — which
  // is itself a fork — is required to attach a braid. Authorship is a VO
  // rather than a bare model string so manual edits do not masquerade as
  // LLM-generated content.
  initialBraid?: BraidContent;
  variables?: readonly PromptVariable[];
  createdAt?: Date;
  updatedAt?: Date;
}

// Pair the braid graph with its authorship. When non-null the version is
// braid-flavoured; null means classical.
interface BraidContent {
  graph: BraidGraph;
  authorship: BraidAuthorship;
}

interface InternalState {
  id: string;
  promptId: string;
  organizationId: string;
  version: string;
  name: string | null;
  parentVersionId: string | null;
  sourcePrompt: string;
  // Null = classical version. Non-null = braid version with the parsed VOs.
  braid: BraidContent | null;
  variables: PromptVariable[];
  // Null until the user saves a layout. VO so equality + validation
  // happen at the aggregate boundary; layout edits go through
  // `setBraidGraphLayout` and don't fork.
  braidGraphLayout: BraidGraphLayout | null;
  status: VersionStatus;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export class PromptVersion {
  private constructor(private state: InternalState) {}

  static create(params: CreatePromptVersionParams): PromptVersion {
    const now = params.createdAt ?? new Date();
    const variables = [...(params.variables ?? [])];
    assertUniqueVariableNames(variables);
    return new PromptVersion({
      id: params.id,
      promptId: params.promptId,
      organizationId: params.organizationId,
      version: params.version.toString(),
      name: normalizeVersionName(params.name ?? null),
      parentVersionId: params.parentVersionId ?? null,
      sourcePrompt: normalizeSourcePrompt(params.sourcePrompt),
      braid: params.initialBraid ?? null,
      variables,
      braidGraphLayout: null,
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
      organizationId: primitives.organizationId,
      version: primitives.version,
      name: normalizeVersionName(primitives.name),
      parentVersionId: primitives.parentVersionId ?? null,
      sourcePrompt: primitives.sourcePrompt,
      braid: hydrateBraid(primitives.representation),
      variables,
      braidGraphLayout: primitives.braidGraphLayout
        ? BraidGraphLayout.fromPrimitives(primitives.braidGraphLayout)
        : null,
      status: primitives.status,
      revision: primitives.revision,
      createdAt: primitives.createdAt,
      updatedAt: primitives.updatedAt,
    });
  }

  // Fork with a new id and label — the source's body is always inherited;
  // a new braid replaces the source's representation when `initialBraid`
  // is provided. `parentVersionId` is set from the source so lineage is
  // preserved. Variables default to the source's set; callers can override
  // with `variables` to add/remove.
  static fork(params: {
    source: PromptVersion;
    newId: string;
    newLabel: VersionLabel;
    name?: string | null;
    initialBraid?: BraidContent;
    variables?: readonly PromptVariable[];
  }): PromptVersion {
    return PromptVersion.create({
      id: params.newId,
      promptId: params.source.promptId,
      organizationId: params.source.organizationId,
      version: params.newLabel,
      sourcePrompt: params.source.sourcePrompt,
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

  get organizationId(): string {
    return this.state.organizationId;
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
    return this.state.braid?.graph ?? null;
  }

  get braidAuthorship(): BraidAuthorship | null {
    return this.state.braid?.authorship ?? null;
  }

  get generatorModel(): string | null {
    return this.state.braid?.authorship.displayModel ?? null;
  }

  get hasBraidRepresentation(): boolean {
    return this.state.braid !== null;
  }

  get variables(): readonly PromptVariable[] {
    return this.state.variables;
  }

  get braidGraphLayout(): BraidGraphLayout | null {
    return this.state.braidGraphLayout;
  }

  get executablePrompt(): string {
    return this.state.braid?.graph.mermaidCode ?? this.state.sourcePrompt;
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

  // Layout is presentation metadata (where each node is drawn) — saved
  // in place without forking the version. The setter is a no-op when
  // the new layout is value-equal to the current one so a redundant
  // drag (user dragged then dragged back) doesn't bump revision.
  setBraidGraphLayout(layout: BraidGraphLayout | null): void {
    if (layout === null && this.state.braidGraphLayout === null) return;
    if (
      layout !== null
      && this.state.braidGraphLayout !== null
      && this.state.braidGraphLayout.equals(layout)
    ) {
      return;
    }
    this.state = {
      ...this.state,
      braidGraphLayout: layout,
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
      organizationId: this.state.organizationId,
      version: this.state.version,
      name: this.state.name,
      parentVersionId: this.state.parentVersionId,
      sourcePrompt: this.state.sourcePrompt,
      representation: braidToPrimitives(this.state.braid),
      variables: this.state.variables.map((v) => v.toSnapshot()),
      braidGraphLayout: this.state.braidGraphLayout?.toPrimitives() ?? null,
      status: this.state.status,
      revision: this.state.revision,
      createdAt: this.state.createdAt,
      updatedAt: this.state.updatedAt,
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

const hydrateBraid = (
  representation: PromptRepresentationPrimitives,
): BraidContent | null => {
  if (representation.kind === "classical") return null;
  return {
    graph: BraidGraph.parse(representation.graph),
    authorship: BraidAuthorship.fromSnapshot(representation.authorship),
  };
};

const braidToPrimitives = (
  braid: BraidContent | null,
): PromptRepresentationPrimitives => {
  if (braid === null) return { kind: "classical" };
  return {
    kind: "braid",
    graph: braid.graph.mermaidCode,
    authorship: braid.authorship.toSnapshot(),
  };
};
