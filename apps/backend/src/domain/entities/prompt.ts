import type { TaskType } from "@plexus/shared-types";
import { ValidationError } from "../errors/domain-error.js";
import { VersionLabel } from "../value-objects/version-label.js";

// Prompt is the write-side aggregate root for prompt identity and the
// "one production per prompt" pointer. Version content is its own aggregate
// (PromptVersion) referenced by id — the root never loads the version list
// at write time, so rename/promote/generate do not pay an O(|versions|)
// hydrate cost.

export interface PromptPrimitives {
  id: string;
  name: string;
  description: string;
  taskType: TaskType;
  ownerId: string;
  // Canonical reference to the version currently serving production traffic.
  // Label-based display (`productionVersion: "v2"`) is a read-projection
  // concern resolved by the query service, not a field the aggregate tracks.
  productionVersionId: string | null;
  // Monotonic counter driving version label allocation. Never rewound, so
  // labels remain unique even if a version is deleted — decoupled from the
  // live version count which would collide after a delete.
  versionCounter: number;
  // Optimistic-concurrency cursor. Hydrated from the store, gated at save
  // time, advanced by `commit(snapshot)` after a successful write.
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

// Snapshot the aggregate hands to the repository at save time. Versions live
// in their own aggregate now, so the snapshot carries only root state —
// there is no child collection to diff.
export interface PromptSnapshot {
  readonly root: PromptPrimitives;
  readonly expectedRevision: number;
  readonly nextRevision: number;
}

interface InternalPromptState {
  id: string;
  name: string;
  description: string;
  taskType: TaskType;
  ownerId: string;
  productionVersionId: string | null;
  versionCounter: number;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePromptParams {
  promptId: string;
  ownerId: string;
  name: string;
  description: string;
  taskType: TaskType;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Prompt {
  private constructor(private state: InternalPromptState) {}

  static create(params: CreatePromptParams): Prompt {
    const now = params.createdAt ?? new Date();
    return new Prompt({
      id: params.promptId,
      name: params.name,
      description: params.description,
      taskType: params.taskType,
      ownerId: params.ownerId,
      productionVersionId: null,
      versionCounter: 0,
      revision: 0,
      createdAt: now,
      updatedAt: params.updatedAt ?? now,
    });
  }

  static hydrate(prompt: PromptPrimitives): Prompt {
    return new Prompt({
      id: prompt.id,
      name: prompt.name,
      description: prompt.description,
      taskType: prompt.taskType,
      ownerId: prompt.ownerId,
      productionVersionId: prompt.productionVersionId,
      versionCounter: prompt.versionCounter,
      revision: prompt.revision,
      createdAt: prompt.createdAt,
      updatedAt: prompt.updatedAt,
    });
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

  get productionVersionId(): string | null {
    return this.state.productionVersionId;
  }

  get versionCounter(): number {
    return this.state.versionCounter;
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

  assertOwnedBy(userId: string): void {
    if (this.state.ownerId !== userId) {
      throw ValidationError("Caller does not own this prompt");
    }
  }

  isProductionVersion(versionId: string): boolean {
    return this.state.productionVersionId === versionId;
  }

  // Allocates the next monotonic label ("v1", "v2", ...) and advances the
  // counter. Version creation itself happens in the PromptVersion aggregate;
  // the Prompt root owns only the label-allocation invariant.
  allocateNextVersionLabel(): VersionLabel {
    const nextCounter = this.state.versionCounter + 1;
    this.state = { ...this.state, versionCounter: nextCounter };
    this.touch();
    return VersionLabel.fromSequence(nextCounter);
  }

  setProductionVersion(versionId: string): void {
    if (this.state.productionVersionId === versionId) return;
    this.state = { ...this.state, productionVersionId: versionId };
    this.touch();
  }

  clearProductionVersion(): void {
    if (this.state.productionVersionId === null) return;
    this.state = { ...this.state, productionVersionId: null };
    this.touch();
  }

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
        productionVersionId: this.state.productionVersionId,
        versionCounter: this.state.versionCounter,
        revision: nextRevision,
        createdAt: this.state.createdAt,
        updatedAt: this.state.updatedAt,
      },
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
    this.state = { ...this.state, revision: snapshot.nextRevision };
  }

  private touch(): void {
    this.state = { ...this.state, updatedAt: new Date() };
  }
}
