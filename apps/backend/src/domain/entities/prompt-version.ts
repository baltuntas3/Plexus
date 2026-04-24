import type { VersionStatus } from "@plexus/shared-types";
import {
  PromptBraidGeneratorModelRequiredError,
  PromptSourceEmptyError,
  PromptVersionHasNoBraidToUpdateError,
} from "../errors/domain-error.js";
import { BraidGraph } from "../value-objects/braid-graph.js";

export interface ClassicalPromptRepresentationPrimitives {
  kind: "classical";
}

export interface BraidPromptRepresentationPrimitives {
  kind: "braid";
  graph: string;
  generatorModel: string;
}

export type PromptRepresentationPrimitives =
  | ClassicalPromptRepresentationPrimitives
  | BraidPromptRepresentationPrimitives;

export interface PromptVersionPrimitives {
  id: string;
  promptId: string;
  version: string;
  name: string | null;
  sourcePrompt: string;
  representation: PromptRepresentationPrimitives;
  solverModel: string | null;
  status: VersionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePromptVersionParams {
  id: string;
  promptId: string;
  version: string;
  sourcePrompt: string;
  name?: string | null;
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
    public readonly generatorModel: string,
  ) {}

  get executablePrompt(): string {
    return this.graph.mermaidCode;
  }

  toPrimitives(): BraidPromptRepresentationPrimitives {
    return {
      kind: this.kind,
      graph: this.graph.mermaidCode,
      generatorModel: this.generatorModel,
    };
  }
}

export type PromptRepresentation = ClassicalPromptRepresentation | BraidPromptRepresentation;

interface InternalState {
  id: string;
  promptId: string;
  version: string;
  name: string | null;
  sourcePrompt: string;
  representation: PromptRepresentation;
  solverModel: string | null;
  status: VersionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class PromptVersion {
  private constructor(private state: InternalState) {}

  static create(params: CreatePromptVersionParams): PromptVersion {
    const now = params.createdAt ?? new Date();
    return new PromptVersion({
      id: params.id,
      promptId: params.promptId,
      version: params.version,
      name: normalizeVersionName(params.name ?? null),
      sourcePrompt: normalizeSourcePrompt(params.sourcePrompt),
      representation: new ClassicalPromptRepresentation(),
      solverModel: null,
      status: "draft",
      createdAt: now,
      updatedAt: params.updatedAt ?? now,
    });
  }

  static hydrate(primitives: PromptVersionPrimitives): PromptVersion {
    return new PromptVersion({
      id: primitives.id,
      promptId: primitives.promptId,
      version: primitives.version,
      name: normalizeVersionName(primitives.name),
      // Persisted content was already validated at creation time; trust it.
      sourcePrompt: primitives.sourcePrompt,
      representation: hydrateRepresentation(primitives.representation),
      solverModel: primitives.solverModel ?? null,
      status: primitives.status,
      createdAt: primitives.createdAt,
      updatedAt: primitives.updatedAt,
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

  get sourcePrompt(): string {
    return this.state.sourcePrompt;
  }

  get braidGraph(): BraidGraph | null {
    return this.state.representation.kind === "braid" ? this.state.representation.graph : null;
  }

  // Exposes only the domain facts callers are allowed to observe. The
  // concrete representation object stays encapsulated so outer layers do not
  // branch on internal shape and couple themselves to entity internals.
  get generatorModel(): string | null {
    return this.state.representation.kind === "braid"
      ? this.state.representation.generatorModel
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

  get solverModel(): string | null {
    return this.state.solverModel;
  }

  get status(): VersionStatus {
    return this.state.status;
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

  changeStatus(status: VersionStatus): void {
    this.state = {
      ...this.state,
      status,
      updatedAt: new Date(),
    };
  }

  setBraidGraph(graph: BraidGraph, generatorModel: string): void {
    this.state = {
      ...this.state,
      representation: new BraidPromptRepresentation(graph, requireGeneratorModel(generatorModel)),
      updatedAt: new Date(),
    };
  }

  updateBraidGraph(graph: BraidGraph): void {
    if (this.state.representation.kind !== "braid") {
      throw PromptVersionHasNoBraidToUpdateError();
    }
    this.state = {
      ...this.state,
      representation: new BraidPromptRepresentation(
        graph,
        this.state.representation.generatorModel,
      ),
      updatedAt: new Date(),
    };
  }

  toPrimitives(): PromptVersionPrimitives {
    return {
      id: this.state.id,
      promptId: this.state.promptId,
      version: this.state.version,
      name: this.state.name,
      sourcePrompt: this.state.sourcePrompt,
      representation: this.state.representation.toPrimitives(),
      solverModel: this.state.solverModel,
      status: this.state.status,
      createdAt: this.state.createdAt,
      updatedAt: this.state.updatedAt,
    };
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
    requireGeneratorModel(representation.generatorModel),
  );
};

const requireGeneratorModel = (generatorModel: string): string => {
  const trimmed = generatorModel.trim();
  if (trimmed.length === 0) {
    throw PromptBraidGeneratorModelRequiredError();
  }
  return trimmed;
};
