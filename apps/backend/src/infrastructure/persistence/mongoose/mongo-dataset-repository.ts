import type { HydratedDocument, Types } from "mongoose";
import type { TaskType } from "@plexus/shared-types";
import type {
  CreateDatasetInput,
  IDatasetRepository,
  ListDatasetsQuery,
  DatasetListResult,
} from "../../../domain/repositories/dataset-repository.js";
import type { Dataset, TestCase } from "../../../domain/entities/dataset.js";
import { DatasetModel } from "./dataset-model.js";

type TestCaseDoc = {
  _id: Types.ObjectId;
  input: string;
  expectedOutput: string | null;
  metadata: Record<string, unknown>;
};

type DatasetDoc = HydratedDocument<{
  _id: Types.ObjectId;
  name: string;
  description: string;
  taskType: TaskType;
  ownerId: Types.ObjectId;
  testCases: TestCaseDoc[];
  createdAt: Date;
  updatedAt: Date;
}>;

const testCaseToDomain = (doc: TestCaseDoc): TestCase => ({
  id: String(doc._id),
  input: doc.input,
  expectedOutput: doc.expectedOutput,
  metadata: doc.metadata,
});

const toDomain = (doc: DatasetDoc): Dataset => ({
  id: String(doc._id),
  name: doc.name,
  description: doc.description,
  taskType: doc.taskType,
  ownerId: String(doc.ownerId),
  testCases: doc.testCases.map(testCaseToDomain),
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

export class MongoDatasetRepository implements IDatasetRepository {
  async create(input: CreateDatasetInput): Promise<Dataset> {
    const doc = await DatasetModel.create({
      name: input.name,
      description: input.description,
      taskType: input.taskType,
      ownerId: input.ownerId,
      testCases: input.testCases.map((tc) => ({
        _id: tc.id,
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        metadata: tc.metadata,
      })),
    });
    return toDomain(doc as unknown as DatasetDoc);
  }

  async findById(id: string): Promise<Dataset | null> {
    const doc = await DatasetModel.findById(id);
    return doc ? toDomain(doc as unknown as DatasetDoc) : null;
  }

  async list(query: ListDatasetsQuery): Promise<DatasetListResult> {
    const filter: Record<string, unknown> = { ownerId: query.ownerId };
    if (query.search && query.search.length > 0) {
      filter.name = { $regex: query.search, $options: "i" };
    }

    const skip = (query.page - 1) * query.pageSize;
    const [docs, total] = await Promise.all([
      DatasetModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.pageSize),
      DatasetModel.countDocuments(filter),
    ]);

    return {
      items: docs.map((d) => toDomain(d as unknown as DatasetDoc)),
      total,
    };
  }

  async delete(id: string): Promise<void> {
    await DatasetModel.findByIdAndDelete(id);
  }

  async addTestCases(id: string, cases: TestCase[]): Promise<Dataset | null> {
    const doc = await DatasetModel.findByIdAndUpdate(
      id,
      {
        $push: {
          testCases: {
            $each: cases.map((tc) => ({
              _id: tc.id,
              input: tc.input,
              expectedOutput: tc.expectedOutput,
              metadata: tc.metadata,
            })),
          },
        },
      },
      { new: true },
    );
    return doc ? toDomain(doc as unknown as DatasetDoc) : null;
  }

  async removeTestCase(id: string, testCaseId: string): Promise<Dataset | null> {
    const doc = await DatasetModel.findByIdAndUpdate(
      id,
      { $pull: { testCases: { _id: testCaseId } } },
      { new: true },
    );
    return doc ? toDomain(doc as unknown as DatasetDoc) : null;
  }
}
