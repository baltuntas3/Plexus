import type { IDatasetRepository } from "../../../domain/repositories/dataset-repository.js";
import type { Dataset } from "../../../domain/entities/dataset.js";
import { ensureDatasetAccess } from "./ensure-dataset-access.js";

export interface GetDatasetCommand {
  datasetId: string;
  ownerId: string;
}

export class GetDatasetUseCase {
  constructor(private readonly datasets: IDatasetRepository) {}

  async execute(command: GetDatasetCommand): Promise<Dataset> {
    return ensureDatasetAccess(this.datasets, command.datasetId, command.ownerId);
  }
}
