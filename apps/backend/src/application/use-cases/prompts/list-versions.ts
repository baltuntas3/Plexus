import { PromptNotFoundError } from "../../../domain/errors/domain-error.js";
import type {
  IPromptQueryService,
  PromptVersionSummary,
} from "../../queries/prompt-query-service.js";
import type { ListVersionsQueryDto } from "../../dto/prompt-dto.js";

interface ListVersionsCommand extends ListVersionsQueryDto {
  promptId: string;
  organizationId: string;
}

interface VersionListResult {
  items: PromptVersionSummary[];
  total: number;
}

// Single-call read: the query service enforces org-scoping and returns null
// for "missing or in another org", which this use case uniformly translates
// into a 404. No ad-hoc tenant check here — the rule lives inside the query
// service so no caller can forget it.
export class ListVersionsUseCase {
  constructor(private readonly queries: IPromptQueryService) {}

  async execute(command: ListVersionsCommand): Promise<VersionListResult> {
    const result = await this.queries.listVersionSummariesInOrganization({
      promptId: command.promptId,
      organizationId: command.organizationId,
      page: command.page,
      pageSize: command.pageSize,
    });
    if (result === null) {
      throw PromptNotFoundError();
    }
    return result;
  }
}
