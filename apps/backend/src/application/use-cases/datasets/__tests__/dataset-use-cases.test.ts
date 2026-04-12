import { CreateDatasetUseCase } from "../create-dataset.js";
import { GetDatasetUseCase } from "../get-dataset.js";
import { DeleteDatasetUseCase } from "../delete-dataset.js";
import { AddTestCasesUseCase } from "../add-test-cases.js";
import { RemoveTestCaseUseCase } from "../remove-test-case.js";
import { ListDatasetsUseCase } from "../list-datasets.js";
import { InMemoryDatasetRepository } from "../../../../__tests__/fakes/in-memory-dataset-repository.js";

const ownerId = "user-1";
const otherId = "user-2";

const makeDataset = () => ({
  name: "Math QA",
  description: "Math questions",
  taskType: "math" as const,
  testCases: [
    { input: "What is 2+2?", expectedOutput: "4", metadata: {} },
  ],
});

describe("CreateDatasetUseCase", () => {
  it("creates a dataset with test cases", async () => {
    const repo = new InMemoryDatasetRepository();
    const uc = new CreateDatasetUseCase(repo);

    const dataset = await uc.execute({ ...makeDataset(), ownerId });

    expect(dataset.name).toBe("Math QA");
    expect(dataset.testCases).toHaveLength(1);
    expect(dataset.testCases[0]?.id).toBeTruthy();
    expect(dataset.ownerId).toBe(ownerId);
  });

  it("creates a dataset without test cases", async () => {
    const repo = new InMemoryDatasetRepository();
    const uc = new CreateDatasetUseCase(repo);

    const dataset = await uc.execute({
      name: "Empty",
      description: "",
      taskType: "general",
      testCases: [],
      ownerId,
    });

    expect(dataset.testCases).toHaveLength(0);
  });
});

describe("GetDatasetUseCase", () => {
  it("returns the dataset for the owner", async () => {
    const repo = new InMemoryDatasetRepository();
    const created = await new CreateDatasetUseCase(repo).execute({ ...makeDataset(), ownerId });

    const dataset = await new GetDatasetUseCase(repo).execute({
      datasetId: created.id,
      ownerId,
    });
    expect(dataset.id).toBe(created.id);
  });

  it("throws NOT_FOUND for unknown id", async () => {
    const repo = new InMemoryDatasetRepository();
    await expect(
      new GetDatasetUseCase(repo).execute({ datasetId: "999", ownerId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws FORBIDDEN for wrong owner", async () => {
    const repo = new InMemoryDatasetRepository();
    const created = await new CreateDatasetUseCase(repo).execute({ ...makeDataset(), ownerId });

    await expect(
      new GetDatasetUseCase(repo).execute({ datasetId: created.id, ownerId: otherId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("DeleteDatasetUseCase", () => {
  it("deletes the dataset", async () => {
    const repo = new InMemoryDatasetRepository();
    const created = await new CreateDatasetUseCase(repo).execute({ ...makeDataset(), ownerId });

    await new DeleteDatasetUseCase(repo).execute({ datasetId: created.id, ownerId });

    const gone = await repo.findById(created.id);
    expect(gone).toBeNull();
  });

  it("throws FORBIDDEN for wrong owner", async () => {
    const repo = new InMemoryDatasetRepository();
    const created = await new CreateDatasetUseCase(repo).execute({ ...makeDataset(), ownerId });

    await expect(
      new DeleteDatasetUseCase(repo).execute({ datasetId: created.id, ownerId: otherId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("AddTestCasesUseCase", () => {
  it("appends test cases to an existing dataset", async () => {
    const repo = new InMemoryDatasetRepository();
    const created = await new CreateDatasetUseCase(repo).execute({ ...makeDataset(), ownerId });

    const updated = await new AddTestCasesUseCase(repo).execute({
      datasetId: created.id,
      ownerId,
      testCases: [{ input: "What is 3+3?", expectedOutput: "6", metadata: {} }],
    });

    expect(updated.testCases).toHaveLength(2);
    expect(updated.testCases[1]?.input).toBe("What is 3+3?");
  });

  it("throws FORBIDDEN for wrong owner", async () => {
    const repo = new InMemoryDatasetRepository();
    const created = await new CreateDatasetUseCase(repo).execute({ ...makeDataset(), ownerId });

    await expect(
      new AddTestCasesUseCase(repo).execute({
        datasetId: created.id,
        ownerId: otherId,
        testCases: [{ input: "x", expectedOutput: null, metadata: {} }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("RemoveTestCaseUseCase", () => {
  it("removes a test case by id", async () => {
    const repo = new InMemoryDatasetRepository();
    const created = await new CreateDatasetUseCase(repo).execute({ ...makeDataset(), ownerId });
    const testCaseId = created.testCases[0]!.id;

    const updated = await new RemoveTestCaseUseCase(repo).execute({
      datasetId: created.id,
      testCaseId,
      ownerId,
    });

    expect(updated.testCases).toHaveLength(0);
  });
});

describe("ListDatasetsUseCase", () => {
  it("lists only the owner's datasets", async () => {
    const repo = new InMemoryDatasetRepository();
    const create = new CreateDatasetUseCase(repo);
    await create.execute({ ...makeDataset(), ownerId });
    await create.execute({ ...makeDataset(), ownerId: otherId });

    const result = await new ListDatasetsUseCase(repo).execute({
      ownerId,
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.ownerId).toBe(ownerId);
  });
});
