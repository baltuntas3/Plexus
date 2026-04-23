import { Types } from "mongoose";
import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import { Prompt, type PromptPrimitives } from "../../../domain/entities/prompt.js";
import type {
  PromptRepresentationPrimitives,
  PromptVersionPrimitives,
} from "../../../domain/entities/prompt-version.js";
import { PromptModel } from "./prompt-model.js";
import { PromptVersionModel } from "./prompt-version-model.js";

interface PromptDocShape {
  _id: Types.ObjectId;
  name: string;
  description: string;
  taskType: PromptPrimitives["taskType"];
  ownerId: Types.ObjectId;
  productionVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface VersionDocShape {
  _id: Types.ObjectId;
  promptId: Types.ObjectId;
  version: string;
  name: string | null;
  sourcePrompt: string;
  representation: {
    kind: "classical" | "braid";
    graph: string | null;
    generatorModel: string | null;
  };
  solverModel: string | null;
  status: PromptVersionPrimitives["status"];
  createdAt: Date;
  updatedAt: Date;
}

const toPromptPrimitives = (doc: PromptDocShape): PromptPrimitives => ({
  id: String(doc._id),
  name: doc.name,
  description: doc.description,
  taskType: doc.taskType,
  ownerId: String(doc.ownerId),
  productionVersion: doc.productionVersion,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

const toRepresentation = (
  doc: VersionDocShape["representation"],
): PromptRepresentationPrimitives => {
  if (doc.kind === "braid" && doc.graph && doc.generatorModel) {
    return { kind: "braid", graph: doc.graph, generatorModel: doc.generatorModel };
  }
  return { kind: "classical" };
};

const toVersionPrimitives = (doc: VersionDocShape): PromptVersionPrimitives => ({
  id: String(doc._id),
  promptId: String(doc.promptId),
  version: doc.version,
  name: doc.name ?? null,
  sourcePrompt: doc.sourcePrompt,
  representation: toRepresentation(doc.representation),
  solverModel: doc.solverModel,
  status: doc.status,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

export const toVersionDocSet = (
  version: PromptVersionPrimitives,
): Record<string, unknown> => ({
  promptId: version.promptId,
  version: version.version,
  name: version.name,
  sourcePrompt: version.sourcePrompt,
  representation:
    version.representation.kind === "braid"
      ? {
          kind: "braid",
          graph: version.representation.graph,
          generatorModel: version.representation.generatorModel,
        }
      : { kind: "classical", graph: null, generatorModel: null },
  solverModel: version.solverModel,
  status: version.status,
  createdAt: version.createdAt,
  updatedAt: version.updatedAt,
});

export class MongoPromptAggregateRepository implements IPromptAggregateRepository {
  async nextPromptId(): Promise<string> {
    return new Types.ObjectId().toString();
  }

  async nextVersionId(): Promise<string> {
    return new Types.ObjectId().toString();
  }

  async findById(id: string): Promise<Prompt | null> {
    const promptDoc = await PromptModel.findById(id).lean<PromptDocShape>();
    if (!promptDoc) {
      return null;
    }
    const versionDocs = await PromptVersionModel.find({ promptId: id })
      .sort({ createdAt: 1 })
      .lean<VersionDocShape[]>();
    return Prompt.hydrate(
      toPromptPrimitives(promptDoc),
      versionDocs.map(toVersionPrimitives),
    );
  }

  async save(prompt: Prompt): Promise<void> {
    const { prompt: promptState, versions } = prompt.toPrimitives();
    await PromptModel.updateOne(
      { _id: promptState.id },
      {
        $set: {
          name: promptState.name,
          description: promptState.description,
          taskType: promptState.taskType,
          ownerId: promptState.ownerId,
          productionVersion: promptState.productionVersion,
          createdAt: promptState.createdAt,
          updatedAt: promptState.updatedAt,
        },
      },
      { upsert: true },
    );

    for (const version of versions) {
      await PromptVersionModel.updateOne(
        { _id: version.id },
        { $set: toVersionDocSet(version) },
        { upsert: true },
      );
    }
  }
}
