import type { IDatasetRepository } from "../../../domain/repositories/dataset-repository.js";
import type { Dataset } from "../../../domain/entities/dataset.js";
import type { AddTestCasesDto } from "../../dto/dataset-dto.js";
import { ensureDatasetAccess } from "./ensure-dataset-access.js";
import { NotFoundError } from "../../../domain/errors/domain-error.js";

export interface AddTestCasesCommand extends AddTestCasesDto {
  datasetId: string;
  ownerId: string;
}

export class AddTestCasesUseCase {
  constructor(private readonly datasets: IDatasetRepository) {}

  async execute(command: AddTestCasesCommand): Promise<Dataset> {
    await ensureDatasetAccess(this.datasets, command.datasetId, command.ownerId);

    const result = await this.datasets.addTestCases(
      command.datasetId,
      command.testCases.map((tc) => ({
        id: crypto.randomUUID(),
        input: tc.input,
        expectedOutput: tc.expectedOutput ?? null,
        metadata: tc.metadata,
      })),
    );

    if (!result) {
      throw NotFoundError("Dataset not found");
    }

    return result;
  }
}
