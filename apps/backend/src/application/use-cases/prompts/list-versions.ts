import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import type { ListVersionsQueryDto } from "../../dto/prompt-dto.js";
import { loadOwnedPrompt } from "./load-owned-prompt.js";

export interface ListVersionsCommand extends ListVersionsQueryDto {
  promptId: string;
  ownerId: string;
}

export interface VersionListResult {
  items: PromptVersion[];
  total: number;
}

// A prompt and its versions live in the same aggregate, so we load the
// aggregate root once and paginate its version list in memory rather than
// going out-of-aggregate for a second query. Version counts per prompt are
// expected to stay small; if that ever changes this falls out of scope for
// the write-side repo.
export class ListVersionsUseCase {
  constructor(private readonly prompts: IPromptAggregateRepository) {}

  async execute(command: ListVersionsCommand): Promise<VersionListResult> {
    const prompt = await loadOwnedPrompt(this.prompts, command.promptId, command.ownerId);
    // Aggregate keeps versions in creation order; UI wants newest-first.
    // No independent sort here — the aggregate is the single source of truth
    // for ordering and we just reverse for presentation.
    const all = [...prompt.versions].reverse();
    const start = (command.page - 1) * command.pageSize;
    return {
      items: all.slice(start, start + command.pageSize),
      total: all.length,
    };
  }
}
