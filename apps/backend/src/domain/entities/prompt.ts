import type { TaskType } from "@plexus/shared-types";
import { PromptNotOwnedError, ValidationError } from "../errors/domain-error.js";
import { VersionLabel } from "../value-objects/version-label.js";

// Prompt is the write-side aggregate root for prompt identity and the
// "one production per prompt" pointer. Version content is its own aggregate
// (PromptVersion) referenced by id — the root never loads the version list
// at write time, so promote/generate do not pay an O(|versions|) hydrate
// cost.

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

// Snapshot the aggregate hands to the repository at save time.
// `primitives.revision` is already the post-write value; `expectedRevision`
// is the WHERE-clause guard used for optimistic concurrency.
export interface PromptSnapshot {
  readonly primitives: PromptPrimitives;
  readonly expectedRevision: number;
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
  private constructor(private state: PromptPrimitives) {}

  static create(params: CreatePromptParams): Prompt {
    const name = params.name.trim();
    if (name.length === 0) {
      throw ValidationError("Prompt name must not be empty");
    }
    const now = params.createdAt ?? new Date();
    return new Prompt({
      id: params.promptId,
      name,
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
      throw PromptNotOwnedError();
    }
  }

  isProductionVersion(versionId: string): boolean {
    return this.state.productionVersionId === versionId;
  }

  // Allocates the next monotonic label ("v1", "v2", ...) and advances the
  // counter. Version creation itself happens in the PromptVersion aggregate;
  // the Prompt root owns only the label-allocation invariant.
  allocateNextVersionLabel(): VersionLabel {
    this.state.versionCounter += 1;
    this.touch();
    return VersionLabel.fromSequence(this.state.versionCounter);
  }

  setProductionVersion(versionId: string): void {
    if (this.state.productionVersionId === versionId) return;
    this.state.productionVersionId = versionId;
    this.touch();
  }

  clearProductionVersion(): void {
    if (this.state.productionVersionId === null) return;
    this.state.productionVersionId = null;
    this.touch();
  }

  toSnapshot(): PromptSnapshot {
    const expectedRevision = this.state.revision;
    return {
      primitives: { ...this.state, revision: expectedRevision + 1 },
      expectedRevision,
    };
  }

  markPersisted(): void {
    this.state.revision += 1;
  }

  private touch(): void {
    this.state.updatedAt = new Date();
  }
}
