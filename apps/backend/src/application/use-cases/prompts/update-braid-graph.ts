import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { IUnitOfWork } from "../../../domain/services/unit-of-work.js";
import { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import {
  forkVersionWithGraph,
  type ForkVersionWithGraphResult,
} from "../../services/braid/fork-version-with-graph.js";
import type { GraphLinter } from "../../services/braid/lint/graph-linter.js";
import { loadPromptAndVersionInOrganization } from "./load-owned-prompt.js";

export interface UpdateBraidGraphCommand {
  promptId: string;
  version: string;
  organizationId: string;
  userId: string;
  mermaidCode: string;
}

export type UpdateBraidGraphResult = ForkVersionWithGraphResult;

// Manual mermaid edit (whole-graph replacement). The 5 structural
// edit primitives (RenameBraidNode, AddBraidNode, …) live in their
// own use cases; this one is the "I just edited the raw mermaid"
// path used by the text-mode editor.
export class UpdateBraidGraphUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly linter: GraphLinter,
    private readonly idGenerator: IIdGenerator,
    private readonly uow: IUnitOfWork,
  ) {}

  async execute(command: UpdateBraidGraphCommand): Promise<UpdateBraidGraphResult> {
    return this.uow.run(async () => {
      const { prompt, version: source } = await loadPromptAndVersionInOrganization(
        this.prompts,
        this.versions,
        command.promptId,
        command.version,
        command.organizationId,
      );
      if (!source.hasBraidRepresentation) {
        throw ValidationError(
          "Cannot edit mermaid on a version that has no BRAID graph yet",
        );
      }
      const newGraph = BraidGraph.parse(command.mermaidCode);
      return forkVersionWithGraph({
        prompt,
        source,
        newGraph,
        linter: this.linter,
        idGenerator: this.idGenerator,
        versions: this.versions,
        prompts: this.prompts,
      });
    });
  }
}

export type { GraphQualityScore };
