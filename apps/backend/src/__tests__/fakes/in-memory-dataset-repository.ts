import type {
  CreateDatasetInput,
  IDatasetRepository,
  ListDatasetsQuery,
  DatasetListResult,
} from "../../domain/repositories/dataset-repository.js";
import type { Dataset, TestCase } from "../../domain/entities/dataset.js";

export class InMemoryDatasetRepository implements IDatasetRepository {
  private readonly store = new Map<string, Dataset>();
  private nextId = 1;

  async create(input: CreateDatasetInput): Promise<Dataset> {
    const now = new Date();
    const id = String(this.nextId++);
    const dataset: Dataset = {
      id,
      name: input.name,
      description: input.description,
      taskType: input.taskType,
      ownerId: input.ownerId,
      testCases: input.testCases,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(id, dataset);
    return dataset;
  }

  async findById(id: string): Promise<Dataset | null> {
    return this.store.get(id) ?? null;
  }

  async list(query: ListDatasetsQuery): Promise<DatasetListResult> {
    let items = [...this.store.values()].filter((d) => d.ownerId === query.ownerId);
    if (query.search) {
      const lower = query.search.toLowerCase();
      items = items.filter((d) => d.name.toLowerCase().includes(lower));
    }
    const start = (query.page - 1) * query.pageSize;
    return { items: items.slice(start, start + query.pageSize), total: items.length };
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async addTestCases(id: string, cases: TestCase[]): Promise<Dataset | null> {
    const dataset = this.store.get(id);
    if (!dataset) return null;
    const updated: Dataset = {
      ...dataset,
      testCases: [...dataset.testCases, ...cases],
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return updated;
  }

  async removeTestCase(id: string, testCaseId: string): Promise<Dataset | null> {
    const dataset = this.store.get(id);
    if (!dataset) return null;
    const updated: Dataset = {
      ...dataset,
      testCases: dataset.testCases.filter((tc) => tc.id !== testCaseId),
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return updated;
  }
}
