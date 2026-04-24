import type {
  IPromptQueryService,
  PromptSummary,
} from "../../queries/prompt-query-service.js";
import { PromptNotFoundError } from "../../../domain/errors/domain-error.js";

// Read-side use case: hands back a projection, not the aggregate. Write
// flows still load the full Prompt via `loadOwnedPrompt`; callers that only
// need to display the prompt avoid that cost and do not have to know about
// the aggregate shape. Collapses "missing" and "not yours" into a single
// 404 at the query-service boundary.
export class GetPromptUseCase {
  constructor(private readonly queries: IPromptQueryService) {}

  async execute(promptId: string, ownerId: string): Promise<PromptSummary> {
    const summary = await this.queries.findOwnedPromptSummary(promptId, ownerId);
    if (!summary) {
      throw PromptNotFoundError();
    }
    return summary;
  }
}
