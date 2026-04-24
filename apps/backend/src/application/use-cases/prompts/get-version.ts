import type {
  IPromptQueryService,
  PromptVersionSummary,
} from "../../queries/prompt-query-service.js";
import { PromptVersionNotFoundError } from "../../../domain/errors/domain-error.js";

// Read-side lookup by (promptId + label). The query service owns the
// ownership join and the label→version resolution; missing prompt, missing
// label, and foreign ownership collapse to the same `null` so id
// enumeration cannot distinguish them.
export class GetVersionUseCase {
  constructor(private readonly queries: IPromptQueryService) {}

  async execute(command: {
    promptId: string;
    version: string;
    ownerId: string;
  }): Promise<PromptVersionSummary> {
    const match = await this.queries.findOwnedVersionByLabel(
      command.promptId,
      command.version,
      command.ownerId,
    );
    if (!match) {
      throw PromptVersionNotFoundError(command.version);
    }
    return match;
  }
}
