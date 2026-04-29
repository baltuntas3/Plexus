import type {
  IPromptQueryService,
  PromptSummary,
} from "../../queries/prompt-query-service.js";
import { PromptNotFoundError } from "../../../domain/errors/domain-error.js";

// Read-side use case: hands back a projection, not the aggregate. Write
// flows still load the full Prompt via `loadPromptInOrganization`;
// callers that only need to display the prompt avoid that cost and do not
// have to know about the aggregate shape. Collapses "missing" and "in
// another org" into a single 404 at the query-service boundary.
export class GetPromptUseCase {
  constructor(private readonly queries: IPromptQueryService) {}

  async execute(promptId: string, organizationId: string): Promise<PromptSummary> {
    const summary = await this.queries.findPromptSummaryInOrganization(
      promptId,
      organizationId,
    );
    if (!summary) {
      throw PromptNotFoundError();
    }
    return summary;
  }
}
