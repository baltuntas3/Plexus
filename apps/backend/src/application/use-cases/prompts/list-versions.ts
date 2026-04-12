import type { IPromptRepository } from "../../../domain/repositories/prompt-repository.js";
import type {
  IPromptVersionRepository,
  VersionListResult,
} from "../../../domain/repositories/prompt-version-repository.js";
import type { ListVersionsQueryDto } from "../../dto/prompt-dto.js";
import { ensurePromptAccess } from "./ensure-prompt-access.js";

export interface ListVersionsCommand extends ListVersionsQueryDto {
  promptId: string;
  ownerId: string;
}

export class ListVersionsUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
  ) {}

  async execute(command: ListVersionsCommand): Promise<VersionListResult> {
    await ensurePromptAccess(this.prompts, command.promptId, command.ownerId);
    return this.versions.list({
      promptId: command.promptId,
      page: command.page,
      pageSize: command.pageSize,
    });
  }
}
