import type { IDatasetRepository } from "../../../domain/repositories/dataset-repository.js";
import type { Dataset } from "../../../domain/entities/dataset.js";
import type { CreateDatasetDto } from "../../dto/dataset-dto.js";

export interface CreateDatasetCommand extends CreateDatasetDto {
  ownerId: string;
}

export class CreateDatasetUseCase {
  constructor(private readonly datasets: IDatasetRepository) {}

  async execute(command: CreateDatasetCommand): Promise<Dataset> {
    return this.datasets.create({
      name: command.name,
      description: command.description,
      taskType: command.taskType,
      ownerId: command.ownerId,
      testCases: command.testCases.map((tc) => ({
        id: crypto.randomUUID(),
        input: tc.input,
        expectedOutput: tc.expectedOutput ?? null,
        metadata: tc.metadata,
      })),
    });
  }
}
