import type { TaskType } from "@plexus/shared-types";
import {
  PromptInvalidVersionTransitionError,
  PromptNotOwnedError,
  PromptVersionNotFoundError,
  ValidationError,
} from "../errors/domain-error.js";
import type { BraidAuthorship } from "../value-objects/braid-authorship.js";
import type { BraidGraph } from "../value-objects/braid-graph.js";
import { VersionLabel } from "../value-objects/version-label.js";
import {
  PromptVersion,
  PromptVersionInternal,
  type PromptVersionPrimitives,
} from "./prompt-version.js";

// PromptVersion content is immutable; every graph edit (manual mermaid tweak,
// regenerate, chat refinement) forks a new version rather than mutating in
// place. That's what keeps BenchmarkResult ↔ PromptVersion linkage stable.

export interface PromptPrimitives {
  id: string;
  name: string;
  description: string;
  taskType: TaskType;
  ownerId: string;
  productionVersion: string | null;
  // Monotonic counter driving version label allocation. Never rewound, so
  // labels remain unique even if a version is deleted in the future —
  // decoupled from `versions.length` which would collide after a delete.
  versionCounter: number;
  // Optimistic-concurrency cursor. Hydrated from the store, gated at save
  // time, advanced by `commit(snapshot)` after a successful write.
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

// Transport object exchanged with the repository at save time. The root
// primitives already carry the incremented revision so the repo writes the
// new cursor atomically with the rest of the state; `expectedRevision` is
// the optimistic-concurrency gate. `commit(snapshot)` advances the
// aggregate's in-memory revision once persistence succeeds. Mirrors the
// Benchmark aggregate's snapshot protocol.
export interface PromptSnapshot {
  readonly root: PromptPrimitives;
  readonly versions: readonly PromptVersionPrimitives[];
  readonly expectedRevision: number;
  readonly nextRevision: number;
}

interface InternalPromptState {
  id: string;
  name: string;
  description: string;
  taskType: TaskType;
  ownerId: string;
  productionVersion: VersionLabel | null;
  versionCounter: number;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePromptParams {
  promptId: string;
  initialVersionId: string;
  ownerId: string;
  name: string;
  description: string;
  taskType: TaskType;
  initialPrompt: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Prompt {
  private constructor(
    private state: InternalPromptState,
    private versionsState: PromptVersion[],
  ) {}

  static create(params: CreatePromptParams): Prompt {
    const now = params.createdAt ?? new Date();
    const initialVersion = PromptVersion.create({
      id: params.initialVersionId,
      promptId: params.promptId,
      version: VersionLabel.fromSequence(1),
      sourcePrompt: params.initialPrompt,
      parentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    return new Prompt(
      {
        id: params.promptId,
        name: params.name,
        description: params.description,
        taskType: params.taskType,
        ownerId: params.ownerId,
        productionVersion: null,
        versionCounter: 1,
        revision: 0,
        createdAt: now,
        updatedAt: params.updatedAt ?? now,
      },
      [initialVersion],
    );
  }

  static hydrate(
    prompt: PromptPrimitives,
    versions: PromptVersionPrimitives[],
  ): Prompt {
    return new Prompt(
      {
        id: prompt.id,
        name: prompt.name,
        description: prompt.description,
        taskType: prompt.taskType,
        ownerId: prompt.ownerId,
        productionVersion:
          prompt.productionVersion !== null
            ? VersionLabel.parse(prompt.productionVersion)
            : null,
        versionCounter: prompt.versionCounter,
        revision: prompt.revision,
        createdAt: prompt.createdAt,
        updatedAt: prompt.updatedAt,
      },
      versions
        .map((version) => PromptVersion.hydrate(version))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    );
  }

  get id(): string {
    return this.state.id;
  }

  get name(): string {
    return this.state.name;
  }

  get description(): string {
    return this.state.description;
  }

  get taskType(): TaskType {
    return this.state.taskType;
  }

  get ownerId(): string {
    return this.state.ownerId;
  }

  get productionVersion(): string | null {
    return this.state.productionVersion?.toString() ?? null;
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

  // Defensive copy: `readonly` is shallow in TS, so returning the live array
  // would still let a caller mutate aggregate state at runtime.
  get versions(): readonly PromptVersion[] {
    return [...this.versionsState];
  }

  assertOwnedBy(userId: string): void {
    if (this.state.ownerId !== userId) {
      throw PromptNotOwnedError();
    }
  }

  // Lookup by aggregate-internal id. `getVersionByLabel` is the sibling
  // path for the prompt-scoped `VersionLabel` VO. Both are legitimate
  // identifiers for a PromptVersion: the id is globally unique and used
  // for cross-aggregate references (BenchmarkResult → PromptVersion);
  // the label is prompt-scoped, monotonic, part of the ubiquitous
  // language ("promote v2 to production"), and what `productionVersion`
  // persists. HTTP callers arrive with a label and resolve it here at
  // the aggregate boundary; internal operations pass the id directly.
  getVersion(versionId: string): PromptVersion | null {
    return this.versionsState.find((item) => item.id === versionId) ?? null;
  }

  getVersionOrThrow(versionId: string): PromptVersion {
    const match = this.getVersion(versionId);
    if (!match) {
      throw PromptVersionNotFoundError(versionId);
    }
    return match;
  }

  // Label lookup helper — prompt-scoped and human-readable. Owns the
  // label→id bridge so no caller has to iterate `versions` inline.
  getVersionByLabel(label: string): PromptVersion | null {
    return this.versionsState.find((item) => item.version === label) ?? null;
  }

  getVersionByLabelOrThrow(label: string): PromptVersion {
    const match = this.getVersionByLabel(label);
    if (!match) {
      throw PromptVersionNotFoundError(label);
    }
    return match;
  }

  // Classical authoring path. Without `fromVersionId` the new version is
  // a fresh root; with one, it forks from that ancestor the same way a
  // BRAID edit would. The parent id is resolved via `getVersionOrThrow`
  // inside the aggregate, so no caller can pass a phantom parent even
  // when the HTTP layer only holds a label.
  createVersion(input: {
    id: string;
    sourcePrompt: string;
    name?: string | null;
    fromVersionId?: string | null;
  }): PromptVersion {
    const parentVersionId = input.fromVersionId
      ? this.getVersionOrThrow(input.fromVersionId).id
      : null;
    return this.appendVersion({
      id: input.id,
      sourcePrompt: input.sourcePrompt,
      name: input.name ?? null,
      parentVersionId,
    });
  }

  // Promotion rules are business invariants. Demoting to `draft` is
  // forbidden (draft is the initial working state). Promoting to
  // `production` demotes whatever previously held that slot to `staging`
  // so the "one production per prompt" invariant holds.
  promoteVersion(
    versionId: string,
    targetStatus: PromptVersion["status"],
  ): PromptVersion {
    const target = this.getVersionOrThrow(versionId);
    if (targetStatus === "draft") {
      throw PromptInvalidVersionTransitionError(target.status, "draft");
    }
    if (targetStatus === "production") {
      for (const candidate of this.versionsState) {
        if (candidate.id !== target.id && candidate.status === "production") {
          candidate[PromptVersionInternal].changeStatus("staging");
        }
      }
      this.state = {
        ...this.state,
        productionVersion: target.versionLabel,
      };
    } else if (this.state.productionVersion?.equals(target.versionLabel)) {
      this.state = {
        ...this.state,
        productionVersion: null,
      };
    }

    target[PromptVersionInternal].changeStatus(targetStatus);
    this.touch();
    return target;
  }

  renameVersion(versionId: string, name: string | null): PromptVersion {
    const target = this.getVersionOrThrow(versionId);
    target[PromptVersionInternal].rename(name);
    this.touch();
    return target;
  }

  // Fork-on-edit: every graph edit creates a new version. The source is
  // looked up inside the aggregate by id, so `parentVersionId` on the new
  // fork is guaranteed to reference a real version of *this* aggregate —
  // no caller can pass a phantom parent. Authorship is a VO so manual
  // edits do not masquerade as LLM output.
  upsertBraid(input: {
    sourceVersionId: string;
    graph: BraidGraph;
    authorship: BraidAuthorship;
    forkVersionId: string;
  }): PromptVersion {
    const source = this.getVersionOrThrow(input.sourceVersionId);
    return this.appendVersion({
      id: input.forkVersionId,
      sourcePrompt: source.sourcePrompt,
      name: null,
      parentVersionId: source.id,
      initialBraid: { graph: input.graph, authorship: input.authorship },
    });
  }

  // Single place where a new PromptVersion is appended to the aggregate.
  // Keeps the counter/dirty/touch bookkeeping together and, crucially,
  // makes `parentVersionId` an aggregate-internal decision — never an
  // externally-supplied string.
  private appendVersion(input: {
    id: string;
    sourcePrompt: string;
    name: string | null;
    parentVersionId: string | null;
    initialBraid?: { graph: BraidGraph; authorship: BraidAuthorship };
  }): PromptVersion {
    const nextCounter = this.state.versionCounter + 1;
    const nextVersion = PromptVersion.create({
      id: input.id,
      promptId: this.id,
      version: VersionLabel.fromSequence(nextCounter),
      sourcePrompt: input.sourcePrompt,
      name: input.name,
      parentVersionId: input.parentVersionId,
      initialBraid: input.initialBraid,
    });
    this.versionsState = [...this.versionsState, nextVersion];
    this.state = { ...this.state, versionCounter: nextCounter };
    this.touch();
    return nextVersion;
  }

  // Save-time handoff to the repository. Bundles the root primitives
  // (with `revision` already advanced to `nextRevision` so the repo writes
  // a single coherent row) and the full version list. Which versions have
  // actually changed is a persistence concern; the repo diffs against its
  // last-hydrated copy. Mirrors the Benchmark aggregate's protocol so both
  // aggregates hand off state the same way.
  toSnapshot(): PromptSnapshot {
    const expectedRevision = this.state.revision;
    const nextRevision = expectedRevision + 1;
    return {
      root: {
        id: this.state.id,
        name: this.state.name,
        description: this.state.description,
        taskType: this.state.taskType,
        ownerId: this.state.ownerId,
        productionVersion: this.state.productionVersion?.toString() ?? null,
        versionCounter: this.state.versionCounter,
        revision: nextRevision,
        createdAt: this.state.createdAt,
        updatedAt: this.state.updatedAt,
      },
      versions: this.versionsState.map((version) => version.toPrimitives()),
      expectedRevision,
      nextRevision,
    };
  }

  // Called by the repository after a successful write to advance the
  // in-memory revision cursor. Rejects a snapshot that was taken against
  // a different revision — that would mean the aggregate mutated between
  // snapshot and commit, and silently advancing the cursor would mask the
  // lost write.
  commit(snapshot: PromptSnapshot): void {
    if (snapshot.expectedRevision !== this.state.revision) {
      throw ValidationError(
        "Cannot commit a stale snapshot: aggregate revision advanced since the snapshot was taken",
      );
    }
    this.state = { ...this.state, revision: snapshot.nextRevision };
  }

  private touch(): void {
    this.state = {
      ...this.state,
      updatedAt: new Date(),
    };
  }
}
