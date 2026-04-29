import type {
  IPromptQueryService,
  PromptVersionSummary,
} from "../../queries/prompt-query-service.js";
import { PromptVersionNotFoundError } from "../../../domain/errors/domain-error.js";

// Read-side lookup by (promptId + label). The query service owns the
// org-scoping and the label→version resolution; missing prompt, missing
// label, and cross-org access collapse to the same `null` so id
// enumeration cannot distinguish them.
export class GetVersionUseCase {
  constructor(private readonly queries: IPromptQueryService) {}

  async execute(command: {
    promptId: string;
    version: string;
    organizationId: string;
  }): Promise<PromptVersionSummary> {
    const match = await this.queries.findVersionByLabelInOrganization(
      command.promptId,
      command.version,
      command.organizationId,
    );
    if (!match) {
      throw PromptVersionNotFoundError(command.version);
    }
    return match;
  }
}
