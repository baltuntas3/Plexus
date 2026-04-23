import type {
  IPromptQueryService,
  PromptSummaryListResult,
} from "../../queries/prompt-query-service.js";
import type { ListPromptsQueryDto } from "../../dto/prompt-dto.js";

export interface ListPromptsCommand extends ListPromptsQueryDto {
  ownerId: string;
}

export class ListPromptsUseCase {
  constructor(private readonly queries: IPromptQueryService) {}

  async execute(command: ListPromptsCommand): Promise<PromptSummaryListResult> {
    return this.queries.listPromptSummaries({
      ownerId: command.ownerId,
      page: command.page,
      pageSize: command.pageSize,
      search: command.search,
    });
  }
}
