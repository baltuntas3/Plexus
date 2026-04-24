import type {
  IPromptQueryService,
  PromptVersionSummary,
} from "../../queries/prompt-query-service.js";
import {
  PromptNotFoundError,
  PromptVersionNotFoundError,
} from "../../../domain/errors/domain-error.js";

export interface GetVersionCommand {
  promptId: string;
  version: string;
  ownerId: string;
}

// Read-side use case. Resolves the owning prompt first (so callers cannot
// probe for foreign version ids by guessing), then finds the requested
// label among its versions.
export class GetVersionUseCase {
  constructor(private readonly queries: IPromptQueryService) {}

  async execute(command: GetVersionCommand): Promise<PromptVersionSummary> {
    const owner = await this.queries.findOwnedPromptSummary(
      command.promptId,
      command.ownerId,
    );
    if (!owner) {
      throw PromptNotFoundError();
    }
    const { items } = await this.queries.listVersionSummaries({
      promptId: command.promptId,
      page: 1,
      pageSize: Number.MAX_SAFE_INTEGER,
    });
    const match = items.find((item) => item.version === command.version);
    if (!match) {
      throw PromptVersionNotFoundError(command.version);
    }
    return match;
  }
}
