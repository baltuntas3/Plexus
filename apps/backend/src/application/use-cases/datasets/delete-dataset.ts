import type { IDatasetRepository } from "../../../domain/repositories/dataset-repository.js";
import { ensureDatasetAccess } from "./ensure-dataset-access.js";

export interface DeleteDatasetCommand {
  datasetId: string;
  ownerId: string;
}

export class DeleteDatasetUseCase {
  constructor(private readonly datasets: IDatasetRepository) {}

  async execute(command: DeleteDatasetCommand): Promise<void> {
    await ensureDatasetAccess(this.datasets, command.datasetId, command.ownerId);
    await this.datasets.delete(command.datasetId);
  }
}
