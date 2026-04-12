import { MongoDatasetRepository } from "../infrastructure/persistence/mongoose/mongo-dataset-repository.js";
import { CreateDatasetUseCase } from "../application/use-cases/datasets/create-dataset.js";
import { ListDatasetsUseCase } from "../application/use-cases/datasets/list-datasets.js";
import { GetDatasetUseCase } from "../application/use-cases/datasets/get-dataset.js";
import { DeleteDatasetUseCase } from "../application/use-cases/datasets/delete-dataset.js";
import { AddTestCasesUseCase } from "../application/use-cases/datasets/add-test-cases.js";
import { RemoveTestCaseUseCase } from "../application/use-cases/datasets/remove-test-case.js";
import { GenerateDatasetUseCase } from "../application/use-cases/datasets/generate-dataset.js";
import { DatasetGenerator } from "../application/services/dataset/dataset-generator.js";
import type { IAIProviderFactory } from "../application/services/ai-provider.js";

export interface DatasetComposition {
  createDataset: CreateDatasetUseCase;
  listDatasets: ListDatasetsUseCase;
  getDataset: GetDatasetUseCase;
  deleteDataset: DeleteDatasetUseCase;
  addTestCases: AddTestCasesUseCase;
  removeTestCase: RemoveTestCaseUseCase;
  generateDataset: GenerateDatasetUseCase;
}

export const createDatasetComposition = (aiFactory: IAIProviderFactory): DatasetComposition => {
  const datasets = new MongoDatasetRepository();
  const generator = new DatasetGenerator(aiFactory);

  return {
    createDataset: new CreateDatasetUseCase(datasets),
    listDatasets: new ListDatasetsUseCase(datasets),
    getDataset: new GetDatasetUseCase(datasets),
    deleteDataset: new DeleteDatasetUseCase(datasets),
    addTestCases: new AddTestCasesUseCase(datasets),
    removeTestCase: new RemoveTestCaseUseCase(datasets),
    generateDataset: new GenerateDatasetUseCase(datasets, generator),
  };
};
