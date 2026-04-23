import { Types } from "mongoose";
import type { TaskType } from "@plexus/shared-types";
import type {
  IPromptQueryService,
  ListPromptSummariesQuery,
  PromptSummary,
  PromptSummaryListResult,
} from "../../../application/queries/prompt-query-service.js";
import {
  PromptVersion,
  type PromptRepresentationPrimitives,
  type PromptVersionPrimitives,
} from "../../../domain/entities/prompt-version.js";
import { PromptModel } from "./prompt-model.js";
import { PromptVersionModel } from "./prompt-version-model.js";

interface PromptSummaryDoc {
  _id: Types.ObjectId;
  name: string;
  description: string;
  taskType: TaskType;
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

const toSummary = (doc: PromptSummaryDoc): PromptSummary => ({
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

const toDomainVersion = (doc: VersionDocShape): PromptVersion =>
  PromptVersion.hydrate({
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

export class MongoPromptQueryService implements IPromptQueryService {
  async listPromptSummaries(query: ListPromptSummariesQuery): Promise<PromptSummaryListResult> {
    const filter: Record<string, unknown> = { ownerId: query.ownerId };
    if (query.search && query.search.length > 0) {
      filter.name = { $regex: query.search, $options: "i" };
    }

    const skip = (query.page - 1) * query.pageSize;
    const [docs, total] = await Promise.all([
      PromptModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(query.pageSize)
        .lean<PromptSummaryDoc[]>(),
      PromptModel.countDocuments(filter),
    ]);

    return { items: docs.map(toSummary), total };
  }

  async findPromptSummariesByIds(
    ids: readonly string[],
  ): Promise<Map<string, PromptSummary>> {
    if (ids.length === 0) {
      return new Map();
    }
    const docs = await PromptModel.find({ _id: { $in: ids } }).lean<PromptSummaryDoc[]>();
    const map = new Map<string, PromptSummary>();
    for (const doc of docs) {
      const summary = toSummary(doc);
      map.set(summary.id, summary);
    }
    return map;
  }

  async findVersionById(id: string): Promise<PromptVersion | null> {
    const doc = await PromptVersionModel.findById(id).lean<VersionDocShape>();
    return doc ? toDomainVersion(doc) : null;
  }

  async findVersionsByIds(ids: readonly string[]): Promise<Map<string, PromptVersion>> {
    if (ids.length === 0) {
      return new Map();
    }
    const docs = await PromptVersionModel.find({ _id: { $in: ids } }).lean<VersionDocShape[]>();
    const map = new Map<string, PromptVersion>();
    for (const doc of docs) {
      const version = toDomainVersion(doc);
      map.set(version.id, version);
    }
    return map;
  }
}
