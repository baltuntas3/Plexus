import type { IDatasetRepository } from "../../../domain/repositories/dataset-repository.js";
import type { Dataset } from "../../../domain/entities/dataset.js";
import type { DatasetGenerator } from "../../services/dataset/dataset-generator.js";
import type { GenerateDatasetDto } from "../../dto/dataset-dto.js";

export interface GenerateDatasetCommand extends GenerateDatasetDto {
  ownerId: string;
}

export interface GenerateDatasetResult {
  dataset: Dataset;
  model: string;
  generatedCount: number;
}

export class GenerateDatasetUseCase {
  constructor(
    private readonly datasets: IDatasetRepository,
    private readonly generator: DatasetGenerator,
  ) {}

  async execute(command: GenerateDatasetCommand): Promise<GenerateDatasetResult> {
    const { testCases, model } = await this.generator.generate({
      taskType: command.taskType,
      topic: command.topic,
      count: command.count,
      model: command.model,
    });

    const dataset = await this.datasets.create({
      name: command.name,
      description: command.description,
      taskType: command.taskType,
      ownerId: command.ownerId,
      testCases: testCases.map((tc) => ({
        id: crypto.randomUUID(),
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        metadata: {},
      })),
    });

    return { dataset, model, generatedCount: testCases.length };
  }
}
