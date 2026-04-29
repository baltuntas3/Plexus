import type {
  BenchmarkSummaryListResult,
  IBenchmarkQueryService,
} from "../../queries/benchmark-query-service.js";

export interface ListBenchmarksCommand {
  organizationId: string;
  page: number;
  pageSize: number;
}

// Read-side use case. Goes through IBenchmarkQueryService so list endpoints
// never hydrate a full aggregate just to render a summary — the CQRS split
// keeps both sides narrow.
export class ListBenchmarksUseCase {
  constructor(private readonly queries: IBenchmarkQueryService) {}

  async execute(command: ListBenchmarksCommand): Promise<BenchmarkSummaryListResult> {
    return this.queries.listBenchmarkSummaries(command);
  }
}
