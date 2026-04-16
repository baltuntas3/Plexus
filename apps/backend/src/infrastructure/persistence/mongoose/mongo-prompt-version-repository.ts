import type { HydratedDocument, Types } from "mongoose";
import type { VersionStatus } from "@plexus/shared-types";
import type {
  CreateVersionInput,
  IPromptVersionRepository,
  ListVersionsQuery,
  VersionListResult,
} from "../../../domain/repositories/prompt-version-repository.js";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import { PromptVersionModel } from "./prompt-version-model.js";

type VersionDoc = HydratedDocument<{
  _id: Types.ObjectId;
  promptId: Types.ObjectId;
  version: string;
  classicalPrompt: string;
  braidGraph: string | null;
  generatorModel: string | null;
  solverModel: string | null;
  status: VersionStatus;
  createdAt: Date;
  updatedAt: Date;
}>;

const toDomain = (doc: VersionDoc): PromptVersion => ({
  id: String(doc._id),
  promptId: String(doc.promptId),
  version: doc.version,
  classicalPrompt: doc.classicalPrompt,
  braidGraph: doc.braidGraph,
  generatorModel: doc.generatorModel,
  solverModel: doc.solverModel,
  status: doc.status,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

export class MongoPromptVersionRepository implements IPromptVersionRepository {
  async create(input: CreateVersionInput): Promise<PromptVersion> {
    const doc = await PromptVersionModel.create({ ...input, status: "draft" });
    return toDomain(doc as unknown as VersionDoc);
  }

  async findById(id: string): Promise<PromptVersion | null> {
    const doc = await PromptVersionModel.findById(id);
    return doc ? toDomain(doc as unknown as VersionDoc) : null;
  }

  async findByPromptAndVersion(promptId: string, version: string): Promise<PromptVersion | null> {
    const doc = await PromptVersionModel.findOne({ promptId, version });
    return doc ? toDomain(doc as unknown as VersionDoc) : null;
  }

  async list(query: ListVersionsQuery): Promise<VersionListResult> {
    const skip = (query.page - 1) * query.pageSize;
    const [docs, total] = await Promise.all([
      PromptVersionModel.find({ promptId: query.promptId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(query.pageSize),
      PromptVersionModel.countDocuments({ promptId: query.promptId }),
    ]);

    return {
      items: docs.map((d) => toDomain(d as unknown as VersionDoc)),
      total,
    };
  }

  async countByPrompt(promptId: string): Promise<number> {
    return PromptVersionModel.countDocuments({ promptId });
  }

  async findCurrentByStatus(promptId: string, status: VersionStatus): Promise<PromptVersion | null> {
    const doc = await PromptVersionModel.findOne({ promptId, status });
    return doc ? toDomain(doc as unknown as VersionDoc) : null;
  }

  async updateStatus(id: string, status: VersionStatus): Promise<void> {
    await PromptVersionModel.updateOne({ _id: id }, { status });
  }

  async setBraidGraph(id: string, braidGraph: string, generatorModel: string): Promise<void> {
    await PromptVersionModel.updateOne({ _id: id }, { braidGraph, generatorModel });
  }

  async updateBraidGraph(id: string, braidGraph: string): Promise<void> {
    await PromptVersionModel.updateOne({ _id: id }, { braidGraph });
  }
}
