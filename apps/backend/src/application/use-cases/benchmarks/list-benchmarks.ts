import type {
  BenchmarkListResult,
  IBenchmarkRepository,
} from "../../../domain/repositories/benchmark-repository.js";

export interface ListBenchmarksCommand {
  ownerId: string;
  page: number;
  pageSize: number;
}

export class ListBenchmarksUseCase {
  constructor(private readonly benchmarks: IBenchmarkRepository) {}

  async execute(command: ListBenchmarksCommand): Promise<BenchmarkListResult> {
    return this.benchmarks.list(command);
  }
}
