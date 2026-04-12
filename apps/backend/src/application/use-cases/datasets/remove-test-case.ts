import type { IDatasetRepository } from "../../../domain/repositories/dataset-repository.js";
import type { Dataset } from "../../../domain/entities/dataset.js";
import { ensureDatasetAccess } from "./ensure-dataset-access.js";
import { NotFoundError } from "../../../domain/errors/domain-error.js";

export interface RemoveTestCaseCommand {
  datasetId: string;
  testCaseId: string;
  ownerId: string;
}

export class RemoveTestCaseUseCase {
  constructor(private readonly datasets: IDatasetRepository) {}

  async execute(command: RemoveTestCaseCommand): Promise<Dataset> {
    await ensureDatasetAccess(this.datasets, command.datasetId, command.ownerId);

    const result = await this.datasets.removeTestCase(command.datasetId, command.testCaseId);

    if (!result) {
      throw NotFoundError("Dataset not found");
    }

    return result;
  }
}
