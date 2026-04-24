import type { TaskType } from "@plexus/shared-types";
import {
  PromptInvalidVersionTransitionError,
  PromptNotOwnedError,
  PromptVersionNotFoundError,
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
  // time, advanced by `markPersisted` after a successful write.
  revision: number;
  createdAt: Date;
  updatedAt: Date;
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
  // Version ids touched since the last save. Drained by the repository so
  // it only upserts what actually changed — fork-on-edit grows the version
  // list monotonically, and paying O(|versions|) writes per edit is the
  // cost this set exists to avoid. Not a "domain event" because nothing
  // outside the repository reads it; keeping the shape flat until a real
  // subscriber appears.
  private dirtyVersionIds = new Set<string>();

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
    const prompt = new Prompt(
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
    prompt.dirtyVersionIds.add(initialVersion.id);
    return prompt;
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

  getVersion(version: string): PromptVersion | null {
    return this.versionsState.find((item) => item.version === version) ?? null;
  }

  getVersionOrThrow(version: string): PromptVersion {
    const match = this.getVersion(version);
    if (!match) {
      throw PromptVersionNotFoundError(version);
    }
    return match;
  }

  createVersion(input: {
    id: string;
    sourcePrompt: string;
    name?: string | null;
    parentVersionId?: string | null;
    initialBraid?: { graph: BraidGraph; authorship: BraidAuthorship };
  }): PromptVersion {
    const nextCounter = this.state.versionCounter + 1;
    const nextVersion = PromptVersion.create({
      id: input.id,
      promptId: this.id,
      version: VersionLabel.fromSequence(nextCounter),
      sourcePrompt: input.sourcePrompt,
      name: input.name ?? null,
      parentVersionId: input.parentVersionId ?? null,
      initialBraid: input.initialBraid,
    });
    this.versionsState = [...this.versionsState, nextVersion];
    this.state = { ...this.state, versionCounter: nextCounter };
    this.dirtyVersionIds.add(nextVersion.id);
    this.touch();
    return nextVersion;
  }

  // Promotion rules are business invariants. Demoting to `draft` is
  // forbidden (draft is the initial working state). Promoting to
  // `production` demotes whatever previously held that slot to `staging`
  // so the "one production per prompt" invariant holds.
  promoteVersion(
    version: string,
    targetStatus: PromptVersion["status"],
  ): PromptVersion {
    const target = this.getVersionOrThrow(version);
    if (targetStatus === "draft") {
      throw PromptInvalidVersionTransitionError(target.status, "draft");
    }
    if (targetStatus === "production") {
      for (const candidate of this.versionsState) {
        if (candidate.id !== target.id && candidate.status === "production") {
          candidate[PromptVersionInternal].changeStatus("staging");
          this.dirtyVersionIds.add(candidate.id);
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
    this.dirtyVersionIds.add(target.id);
    this.touch();
    return target;
  }

  renameVersion(version: string, name: string | null): PromptVersion {
    const target = this.getVersionOrThrow(version);
    target[PromptVersionInternal].rename(name);
    this.dirtyVersionIds.add(target.id);
    this.touch();
    return target;
  }

  // Fork-on-edit: every graph edit creates a new version. `authorship` is a
  // VO so manual edits do not masquerade as LLM output — callers decide
  // based on what actually produced the graph.
  upsertBraid(input: {
    version: string;
    graph: BraidGraph;
    authorship: BraidAuthorship;
    forkVersionId: string;
  }): PromptVersion {
    const source = this.getVersionOrThrow(input.version);
    return this.createVersion({
      id: input.forkVersionId,
      sourcePrompt: source.sourcePrompt,
      parentVersionId: source.id,
      initialBraid: { graph: input.graph, authorship: input.authorship },
    });
  }

  // Primitives for the repository. Root and versions separated so the repo
  // can write them independently (root row + per-version docs).
  toPrimitives(): PromptPrimitives {
    return {
      id: this.state.id,
      name: this.state.name,
      description: this.state.description,
      taskType: this.state.taskType,
      ownerId: this.state.ownerId,
      productionVersion: this.state.productionVersion?.toString() ?? null,
      versionCounter: this.state.versionCounter,
      revision: this.state.revision,
      createdAt: this.state.createdAt,
      updatedAt: this.state.updatedAt,
    };
  }

  versionPrimitives(): readonly PromptVersionPrimitives[] {
    return this.versionsState.map((version) => version.toPrimitives());
  }

  // Drained by the repository at save time. Returning and clearing in one
  // call prevents double-counting on a retry: if the write fails the
  // aggregate is already empty, the caller retries from a fresh mutation.
  pullDirtyVersionIds(): readonly string[] {
    const ids = [...this.dirtyVersionIds];
    this.dirtyVersionIds.clear();
    return ids;
  }

  // Called by the repository after a successful write. Advances the
  // optimistic-concurrency cursor so the next save compares against the
  // just-written revision.
  markPersisted(revision: number): void {
    this.state = { ...this.state, revision };
  }

  private touch(): void {
    this.state = {
      ...this.state,
      updatedAt: new Date(),
    };
  }
}
