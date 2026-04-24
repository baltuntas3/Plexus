import type { TaskType } from "@plexus/shared-types";
import {
  PromptInvalidVersionTransitionError,
  PromptNotOwnedError,
  PromptVersionNotFoundError,
  ValidationError,
} from "../errors/domain-error.js";
import type { BraidGraph } from "../value-objects/braid-graph.js";
import { VersionLabel } from "../value-objects/version-label.js";
import {
  PromptVersion,
  PromptVersionInternal,
  type PromptVersionPrimitives,
} from "./prompt-version.js";

// All prompt-edit flows (manual mermaid save, regenerate, chat refinement)
// produce a brand-new, immutable PromptVersion through this aggregate.
// PromptVersion never mutates its content after creation — the write-once
// invariant is what keeps BenchmarkResult ↔ PromptVersion linkage stable
// across subsequent edits.

// Persistence-boundary shape. `productionVersion` is serialized as a plain
// string; the aggregate's internal state uses VersionLabel so the "v{n}"
// invariant is type-enforced inside the aggregate.
export interface PromptPrimitives {
  id: string;
  name: string;
  description: string;
  taskType: TaskType;
  ownerId: string;
  productionVersion: string | null;
  // Monotonic counter that drives version label allocation. Advanced on every
  // new version (fork or plain create) and never rewound, so labels remain
  // unique even if a version is deleted in the future — decoupled from
  // `versions.length` which would collide after a delete.
  versionCounter: number;
  // Aggregate revision last seen in the store. Hydrated from persistence,
  // checked as the "expected" value during save, and advanced by `commit`
  // after a successful write.
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

// Internal aggregate state. Uses VersionLabel for productionVersion so
// cross-version identity comparisons (promoteVersion) happen through the VO
// rather than ad-hoc string equality.
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
  // Identifiers are allocated by the use case (via IIdGenerator) and passed in.
  // Keeping the aggregate free of that port means Prompt has no infrastructure
  // dependency and can be constructed in pure unit tests with plain strings.
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

// Snapshot passed to the repository for a single save. Carries both the
// expected revision (for the optimistic-concurrency filter) and the next
// revision (what the store should advance to on success) so the repo does
// not need to compute or remember revision math — it just writes what the
// aggregate asked it to.
export interface PromptSnapshot {
  readonly prompt: PromptPrimitives;
  readonly versions: readonly PromptVersionPrimitives[];
  readonly expectedRevision: number;
  readonly nextRevision: number;
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

  // External surface stays string-typed (DTO/shared-types contract). The
  // VersionLabel VO is an aggregate-internal invariant carrier — callers
  // outside the domain do not need the typed wrapper.
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

  // Defensive copy: the `readonly` modifier is shallow in TS, so returning the
  // live array would still let a caller `push` / `splice` into it at runtime
  // and silently mutate aggregate state. PromptVersion instances themselves
  // expose only reader getters — their mutators are symbol-keyed and only
  // reachable via the aggregate root.
  get versions(): readonly PromptVersion[] {
    return [...this.versionsState];
  }

  // Guards the aggregate behind an ownership check so callers cannot forget
  // the rule. Throws PromptNotOwnedError when `userId` does not match; the
  // presentation layer decides what HTTP status that maps to.
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
    initialBraid?: { graph: BraidGraph; generatorModel: string };
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
    this.touch();
    return nextVersion;
  }

  // Promotion rules are business invariants and live here, not in DTO
  // validation. A version can move to `staging` or `production`; demoting
  // back to `draft` is forbidden because draft is the initial working state
  // and would effectively "unpublish" history. Repeated promotion to the
  // current status is a no-op (still updates aggregate timestamp).
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

  renameVersion(version: string, name: string | null): PromptVersion {
    const target = this.getVersionOrThrow(version);
    target[PromptVersionInternal].rename(name);
    this.touch();
    return target;
  }

  // Fork a new version carrying the supplied braid graph. Always produces a
  // new version — PromptVersion content is immutable by design, so every
  // graph edit (manual mermaid tweak, regenerate, chat refinement) creates
  // a new record linked to its parent via `parentVersionId`. This is what
  // keeps the BenchmarkResult → PromptVersion link deterministic: whatever
  // content the benchmark evaluated stays reachable forever under the id
  // that benchmark recorded, even if the user keeps iterating on the braid.
  upsertBraid(input: {
    version: string;
    graph: BraidGraph;
    generatorModel: string;
    forkVersionId: string;
  }): PromptVersion {
    const source = this.getVersionOrThrow(input.version);
    return this.createVersion({
      id: input.forkVersionId,
      sourcePrompt: source.sourcePrompt,
      parentVersionId: source.id,
      initialBraid: { graph: input.graph, generatorModel: input.generatorModel },
    });
  }

  // Produces a one-shot save token. The repository writes `nextRevision`
  // gated on `expectedRevision` and, on success, calls `commit(snapshot)`
  // so the aggregate's in-memory state advances. Writing this as a snapshot
  // rather than as "aggregate + markPersisted" means the repo cannot drift
  // out of sync if it forgets a follow-up call: a stale snapshot passed to
  // `commit` is rejected explicitly.
  toSnapshot(): PromptSnapshot {
    const expectedRevision = this.state.revision;
    const nextRevision = expectedRevision + 1;
    return {
      prompt: {
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

  commit(snapshot: PromptSnapshot): void {
    if (snapshot.expectedRevision !== this.state.revision) {
      throw ValidationError(
        "Cannot commit a stale snapshot: aggregate revision advanced since the snapshot was taken",
      );
    }
    this.state = {
      ...this.state,
      revision: snapshot.nextRevision,
    };
  }

  private touch(): void {
    this.state = {
      ...this.state,
      updatedAt: new Date(),
    };
  }
}
