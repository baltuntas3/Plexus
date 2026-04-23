import type { TaskType } from "@plexus/shared-types";
import { ForbiddenError, NotFoundError } from "../errors/domain-error.js";
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
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePromptParams {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  taskType: TaskType;
  initialVersionId: string;
  initialPrompt: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Prompt {
  private constructor(
    private state: PromptPrimitives,
    private versionsState: PromptVersion[],
  ) {}

  static create(params: CreatePromptParams): Prompt {
    const now = params.createdAt ?? new Date();
    const initialVersion = PromptVersion.create({
      id: params.initialVersionId,
      promptId: params.id,
      version: "v1",
      sourcePrompt: params.initialPrompt,
      createdAt: now,
      updatedAt: now,
    });
    return new Prompt(
      {
        id: params.id,
        name: params.name,
        description: params.description,
        taskType: params.taskType,
        ownerId: params.ownerId,
        productionVersion: null,
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
  // the rule. Throws ForbiddenError when `userId` does not match `ownerId`.
  assertOwnedBy(userId: string): void {
    if (this.state.ownerId !== userId) {
      throw ForbiddenError("You don't own this prompt");
    }
  }

  getVersion(version: string): PromptVersion | null {
    return this.versionsState.find((item) => item.version === version) ?? null;
  }

  getVersionOrThrow(version: string): PromptVersion {
    const match = this.getVersion(version);
    if (!match) {
      throw NotFoundError("Version not found");
    }
    return match;
  }

  createVersion(input: {
    id: string;
    sourcePrompt: string;
    name?: string | null;
  }): PromptVersion {
    const nextVersion = PromptVersion.create({
      id: input.id,
      promptId: this.id,
      version: `v${this.versionsState.length + 1}`,
      sourcePrompt: input.sourcePrompt,
      name: input.name ?? null,
    });
    this.versionsState = [...this.versionsState, nextVersion];
    this.touch();
    return nextVersion;
  }

  promoteVersion(version: string, targetStatus: PromptVersion["status"]): PromptVersion {
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
  // graph the aggregate overwrites it; otherwise a new version is forked using
  // the pre-allocated `newVersionId`. The ID is always required because the
  // caller cannot know in advance which branch the aggregate will take.
  attachGeneratedBraid(input: {
    sourceVersion: string;
    graph: BraidGraph;
    generatorModel: string;
    newVersionId: string;
  }): { version: PromptVersion; createdNewVersion: boolean } {
    const source = this.getVersionOrThrow(input.sourceVersion);
    if (source.hasBraidRepresentation) {
      source.setBraidGraph(input.graph, input.generatorModel);
      this.touch();
      return { version: source, createdNewVersion: false };
    }

    const created = this.createVersion({
      id: input.newVersionId,
      sourcePrompt: source.sourcePrompt,
    });
    created.setBraidGraph(input.graph, input.generatorModel);
    this.touch();
    return { version: created, createdNewVersion: true };
  }

  toPrimitives(): { prompt: PromptPrimitives; versions: PromptVersionPrimitives[] } {
    return {
      prompt: { ...this.state },
      versions: this.versionsState.map((version) => version.toPrimitives()),
    };
  }

  private touch(): void {
    this.state = {
      ...this.state,
      updatedAt: new Date(),
    };
  }
}
