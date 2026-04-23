import type { TaskType } from "@plexus/shared-types";
import {
  PromptForbiddenError,
  PromptVersionNotFoundError,
  ValidationError,
} from "../errors/domain-error.js";
import type { IIdGenerator } from "../services/id-generator.js";
import type { BraidGraph } from "../value-objects/braid-graph.js";
import {
  PromptVersion,
  type PromptVersionPrimitives,
} from "./prompt-version.js";

export interface PromptPrimitives {
  id: string;
  name: string;
  description: string;
  taskType: TaskType;
  ownerId: string;
  productionVersion: string | null;
  // Aggregate revision last seen in the store. Hydrated from persistence,
  // checked as the "expected" value during save, and advanced by `commit`
  // after a successful write.
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePromptParams {
  ownerId: string;
  name: string;
  description: string;
  taskType: TaskType;
  initialPrompt: string;
  idGenerator: IIdGenerator;
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
    private state: PromptPrimitives,
    private versionsState: PromptVersion[],
  ) {}

  static create(params: CreatePromptParams): Prompt {
    const now = params.createdAt ?? new Date();
    const promptId = params.idGenerator.newId();
    const initialVersion = PromptVersion.create({
      id: params.idGenerator.newId(),
      promptId,
      version: "v1",
      sourcePrompt: params.initialPrompt,
      createdAt: now,
      updatedAt: now,
    });
    return new Prompt(
      {
        id: promptId,
        name: params.name,
        description: params.description,
        taskType: params.taskType,
        ownerId: params.ownerId,
        productionVersion: null,
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
      { ...prompt },
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
    return this.state.productionVersion;
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
  // and silently mutate aggregate state. Callers always get the canonical
  // creation-order snapshot.
  get versions(): readonly PromptVersion[] {
    return [...this.versionsState];
  }

  // Guards the aggregate behind an ownership check so callers cannot forget
  // the rule. Throws PromptForbiddenError when `userId` does not match.
  assertOwnedBy(userId: string): void {
    if (this.state.ownerId !== userId) {
      throw PromptForbiddenError();
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

  createVersion(
    input: {
      sourcePrompt: string;
      name?: string | null;
    },
    idGenerator: IIdGenerator,
  ): PromptVersion {
    const nextVersion = PromptVersion.create({
      id: idGenerator.newId(),
      promptId: this.id,
      version: `v${this.versionsState.length + 1}`,
      sourcePrompt: input.sourcePrompt,
      name: input.name ?? null,
    });
    this.versionsState = [...this.versionsState, nextVersion];
    this.touch();
    return nextVersion;
  }

  // Promotion rules are business invariants and live here, not in DTO
  // validation. A version can move to `staging` or `production`; demoting
  // back to `draft` is forbidden because draft is the initial working state
  // and would effectively "unpublish" history. Repeated promotion to the
  // current status is a no-op (still updates aggregate timestamp).
  promoteVersion(version: string, targetStatus: PromptVersion["status"]): PromptVersion {
    if (targetStatus === "draft") {
      throw ValidationError("Cannot demote a version back to draft");
    }
    const target = this.getVersionOrThrow(version);
    if (targetStatus === "production") {
      for (const candidate of this.versionsState) {
        if (candidate.id !== target.id && candidate.status === "production") {
          candidate.changeStatus("staging");
        }
      }
      this.state = {
        ...this.state,
        productionVersion: target.version,
      };
    } else if (this.state.productionVersion === target.version) {
      this.state = {
        ...this.state,
        productionVersion: null,
      };
    }

    target.changeStatus(targetStatus);
    this.touch();
    return target;
  }

  renameVersion(version: string, name: string | null): PromptVersion {
    const target = this.getVersionOrThrow(version);
    target.rename(name);
    this.touch();
    return target;
  }

  updateBraidGraph(version: string, graph: BraidGraph): PromptVersion {
    const target = this.getVersionOrThrow(version);
    target.updateBraidGraph(graph);
    this.touch();
    return target;
  }

  // Attaches a generated BRAID graph. If the source version already carries a
  // graph the aggregate overwrites it; otherwise it forks a new version and
  // only then pulls an id from `idGenerator` (no wasted ids on overwrite).
  attachGeneratedBraid(
    input: {
      sourceVersion: string;
      graph: BraidGraph;
      generatorModel: string;
    },
    idGenerator: IIdGenerator,
  ): { version: PromptVersion; createdNewVersion: boolean } {
    const source = this.getVersionOrThrow(input.sourceVersion);
    if (source.hasBraidRepresentation) {
      source.setBraidGraph(input.graph, input.generatorModel);
      this.touch();
      return { version: source, createdNewVersion: false };
    }

    const created = this.createVersion(
      { sourcePrompt: source.sourcePrompt },
      idGenerator,
    );
    created.setBraidGraph(input.graph, input.generatorModel);
    this.touch();
    return { version: created, createdNewVersion: true };
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
      prompt: { ...this.state, revision: nextRevision },
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
