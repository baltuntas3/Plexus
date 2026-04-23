import { PromptNotFoundError } from "../../../domain/errors/domain-error.js";
import type {
  IPromptQueryService,
  PromptVersionSummary,
  VersionSummaryListResult,
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

// Uses the read-side query service end-to-end. Ownership is enforced by the
// composite `findOwnedPromptSummary` lookup — a single round-trip that
// collapses missing-or-foreign into a uniform 404, keeping the ownership
// rule in one place instead of duplicating an ad-hoc check here.
export class ListVersionsUseCase {
  constructor(private readonly queries: IPromptQueryService) {}

  async execute(command: ListVersionsCommand): Promise<VersionListResult> {
    const owner = await this.queries.findOwnedPromptSummary(command.promptId, command.ownerId);
    if (!owner) {
      throw PromptNotFoundError();
    }

    const result: VersionSummaryListResult = await this.queries.listVersionSummaries({
      promptId: command.promptId,
      page: command.page,
      pageSize: command.pageSize,
    });
    return result;
  }
}
