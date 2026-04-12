import type {
  IPromptRepository,
  PromptListResult,
} from "../../../domain/repositories/prompt-repository.js";
import type { ListPromptsQueryDto } from "../../dto/prompt-dto.js";

export interface ListPromptsCommand extends ListPromptsQueryDto {
  ownerId: string;
}

export class ListPromptsUseCase {
  constructor(private readonly prompts: IPromptRepository) {}

  async execute(command: ListPromptsCommand): Promise<PromptListResult> {
    return this.prompts.list({
      ownerId: command.ownerId,
      page: command.page,
      pageSize: command.pageSize,
      search: command.search,
    });
  }
}
