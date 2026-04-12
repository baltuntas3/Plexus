import type { HydratedDocument, Types } from "mongoose";
import type { TaskType } from "@plexus/shared-types";
import type {
  CreatePromptInput,
  IPromptRepository,
  ListPromptsQuery,
  PromptListResult,
} from "../../../domain/repositories/prompt-repository.js";
import type { Prompt } from "../../../domain/entities/prompt.js";
import { PromptModel } from "./prompt-model.js";

type PromptDoc = HydratedDocument<{
  _id: Types.ObjectId;
  name: string;
  description: string;
  taskType: TaskType;
  ownerId: Types.ObjectId;
  productionVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

const toDomain = (doc: PromptDoc): Prompt => ({
  id: String(doc._id),
  name: doc.name,
  description: doc.description,
  taskType: doc.taskType,
  ownerId: String(doc.ownerId),
  productionVersion: doc.productionVersion,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

export class MongoPromptRepository implements IPromptRepository {
  async create(input: CreatePromptInput): Promise<Prompt> {
    const doc = await PromptModel.create(input);
    return toDomain(doc as unknown as PromptDoc);
  }

  async findById(id: string): Promise<Prompt | null> {
    const doc = await PromptModel.findById(id);
    return doc ? toDomain(doc as unknown as PromptDoc) : null;
  }

  async list(query: ListPromptsQuery): Promise<PromptListResult> {
    const filter: Record<string, unknown> = { ownerId: query.ownerId };
    if (query.search && query.search.length > 0) {
      filter.name = { $regex: query.search, $options: "i" };
    }

    const skip = (query.page - 1) * query.pageSize;
    const [docs, total] = await Promise.all([
      PromptModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.pageSize),
      PromptModel.countDocuments(filter),
    ]);

    return {
      items: docs.map((d) => toDomain(d as unknown as PromptDoc)),
      total,
    };
  }

  async setProductionVersion(promptId: string, version: string | null): Promise<void> {
    await PromptModel.updateOne({ _id: promptId }, { productionVersion: version });
  }
}
