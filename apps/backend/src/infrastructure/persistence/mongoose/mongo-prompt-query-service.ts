import { Types } from "mongoose";
import type { TaskType } from "@plexus/shared-types";
import type {
  IPromptQueryService,
  ListOwnedVersionSummariesQuery,
  ListPromptSummariesQuery,
  PromptSummary,
  PromptSummaryListResult,
  PromptVersionSummary,
  VersionSummaryListResult,
} from "../../../application/queries/prompt-query-service.js";
import { PromptModel } from "./prompt-model.js";
import { PromptVersionModel } from "./prompt-version-model.js";
import {
  toVersionSummary,
  type PromptVersionDocShape,
} from "./prompt-version-mongo-mapper.js";

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

  async findOwnedPromptSummary(
    promptId: string,
    ownerId: string,
  ): Promise<PromptSummary | null> {
    // Composite filter keeps "missing" and "not yours" indistinguishable at
    // the storage boundary — a single round trip, no info leak.
    const doc = await PromptModel.findOne({ _id: promptId, ownerId }).lean<PromptSummaryDoc>();
    return doc ? toSummary(doc) : null;
  }

  async findOwnedPromptSummariesByIds(
    ids: readonly string[],
    ownerId: string,
  ): Promise<Map<string, PromptSummary>> {
    if (ids.length === 0) {
      return new Map();
    }
    const docs = await PromptModel.find({
      _id: { $in: ids },
      ownerId,
    }).lean<PromptSummaryDoc[]>();
    const map = new Map<string, PromptSummary>();
    for (const doc of docs) {
      const summary = toSummary(doc);
      map.set(summary.id, summary);
    }
    return map;
  }

  async listOwnedVersionSummaries(
    query: ListOwnedVersionSummariesQuery,
  ): Promise<VersionSummaryListResult | null> {
    // Ownership gate first: missing prompt and foreign prompt both surface
    // as the same null so the presentation layer cannot accidentally leak
    // "exists but not yours".
    const owned = await PromptModel.exists({
      _id: query.promptId,
      ownerId: query.ownerId,
    });
    if (!owned) return null;

    const filter = { promptId: query.promptId };
    const skip = (query.page - 1) * query.pageSize;
    const [docs, total] = await Promise.all([
      PromptVersionModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(query.pageSize)
        .lean<PromptVersionDocShape[]>(),
      PromptVersionModel.countDocuments(filter),
    ]);
    return { items: docs.map(toVersionSummary), total };
  }

  async findOwnedVersionByLabel(
    promptId: string,
    label: string,
    ownerId: string,
  ): Promise<PromptVersionSummary | null> {
    // Single ownership gate via exist check, then a direct (promptId,
    // version) hit. Missing prompt, foreign prompt, and missing label all
    // collapse to null so presentation uniformly 404s and id enumeration
    // cannot signal "exists but not yours".
    const owned = await PromptModel.exists({ _id: promptId, ownerId });
    if (!owned) return null;
    const doc = await PromptVersionModel.findOne({
      promptId,
      version: label,
    }).lean<PromptVersionDocShape>();
    return doc ? toVersionSummary(doc) : null;
  }

  async findOwnedVersionSummary(
    id: string,
    ownerId: string,
  ): Promise<PromptVersionSummary | null> {
    const doc = await PromptVersionModel.findById(id).lean<PromptVersionDocShape>();
    if (!doc) return null;
    const owned = await PromptModel.exists({
      _id: doc.promptId,
      ownerId,
    });
    if (!owned) return null;
    return toVersionSummary(doc);
  }

  async findOwnedVersionSummariesByIds(
    ids: readonly string[],
    ownerId: string,
  ): Promise<Map<string, PromptVersionSummary>> {
    if (ids.length === 0) {
      return new Map();
    }
    const versionDocs = await PromptVersionModel.find({
      _id: { $in: ids },
    }).lean<PromptVersionDocShape[]>();
    if (versionDocs.length === 0) {
      return new Map();
    }
    // Second round trip to filter by ownership. Denormalising ownerId onto
    // PromptVersion would save this query but drift against the Prompt
    // aggregate on ownership transfer (there is none today, but the owner
    // of truth is the Prompt root, and we want one place to change it).
    const promptIds = [...new Set(versionDocs.map((doc) => String(doc.promptId)))];
    const ownedPromptDocs = await PromptModel.find({
      _id: { $in: promptIds },
      ownerId,
    })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>();
    const ownedPromptIds = new Set(ownedPromptDocs.map((doc) => String(doc._id)));

    const map = new Map<string, PromptVersionSummary>();
    for (const doc of versionDocs) {
      if (!ownedPromptIds.has(String(doc.promptId))) continue;
      const summary = toVersionSummary(doc);
      map.set(summary.id, summary);
    }
    return map;
  }
}
