import type {
  IDatasetRepository,
  DatasetListResult,
} from "../../../domain/repositories/dataset-repository.js";
import type { ListDatasetsQueryDto } from "../../dto/dataset-dto.js";

export interface ListDatasetsCommand extends ListDatasetsQueryDto {
  ownerId: string;
}

export class ListDatasetsUseCase {
  constructor(private readonly datasets: IDatasetRepository) {}

  async execute(command: ListDatasetsCommand): Promise<DatasetListResult> {
    return this.datasets.list({
      ownerId: command.ownerId,
      page: command.page,
      pageSize: command.pageSize,
      search: command.search,
    });
  }
}
