import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { IUnitOfWork } from "../../../domain/services/unit-of-work.js";
import { PromptVersion } from "../../../domain/entities/prompt-version.js";
import { BraidAuthorship } from "../../../domain/value-objects/braid-authorship.js";
import { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import type { GraphLinter } from "../../services/braid/lint/graph-linter.js";
import { assertVariableIntegrity } from "../../services/prompts/variable-integrity.js";
import { loadPromptAndVersionInOrganization } from "./load-owned-prompt.js";

export interface UpdateBraidGraphCommand {
  promptId: string;
  version: string;
  organizationId: string;
  userId: string;
  mermaidCode: string;
}

export interface UpdateBraidGraphResult {
  newVersion: string;
  qualityScore: GraphQualityScore;
}

// Manual mermaid edit: fork the source version carrying the user's graph.
// Authorship is recorded as manual so the fork does not falsely claim the
// parent's model produced this text.
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
      const graph = BraidGraph.parse(command.mermaidCode);

      // Variables are inherited from the source; manual mermaid edits must
      // not reference an undeclared `{{var}}`. Editing the variable list is
      // a separate flow (CreateVersion with `variables`), so this fork
      // path validates against the source's set unchanged.
      assertVariableIntegrity({
        body: source.sourcePrompt,
        mermaid: graph.mermaidCode,
        variables: source.variables,
      });

      const label = prompt.allocateNextVersionLabel();
      const forked = PromptVersion.fork({
        source,
        newId: this.idGenerator.newId(),
        newLabel: label,
        initialBraid: {
          graph,
          authorship: BraidAuthorship.manual(source.generatorModel),
        },
      });

      await this.versions.save(forked);
      await this.prompts.save(prompt);

      return { newVersion: forked.version, qualityScore: this.linter.lint(graph) };
    });
  }
}
