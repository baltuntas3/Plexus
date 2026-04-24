import { PromptNotFoundError } from "../../../domain/errors/domain-error.js";
import type {
  IPromptQueryService,
  PromptVersionSummary,
} from "../../queries/prompt-query-service.js";
import type { ListVersionsQueryDto } from "../../dto/prompt-dto.js";

export interface ListVersionsCommand extends ListVersionsQueryDto {
  promptId: string;
  ownerId: string;
}

export interface VersionListResult {
  items: PromptVersionSummary[];
  total: number;
}

// Single-call read: the query service enforces ownership and returns null
// for "missing or foreign", which this use case uniformly translates into
// a 404. No ad-hoc owner check here — the rule lives inside the query
// service so no caller can forget it.
export class ListVersionsUseCase {
  constructor(private readonly queries: IPromptQueryService) {}

  async execute(command: ListVersionsCommand): Promise<VersionListResult> {
    const result = await this.queries.listOwnedVersionSummaries({
      promptId: command.promptId,
      ownerId: command.ownerId,
      page: command.page,
      pageSize: command.pageSize,
    });
    if (result === null) {
      throw PromptNotFoundError();
    }
    return result;
  }
}
