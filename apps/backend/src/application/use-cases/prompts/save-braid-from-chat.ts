import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { IUnitOfWork } from "../../../domain/services/unit-of-work.js";
import { PromptVersion } from "../../../domain/entities/prompt-version.js";
import { BraidAuthorship } from "../../../domain/value-objects/braid-authorship.js";
import { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";
import type { GraphLinter } from "../../services/braid/lint/graph-linter.js";
import { assertVariableIntegrity } from "../../services/prompts/variable-integrity.js";
import { loadPromptAndVersionInOrganization } from "./load-owned-prompt.js";

// Persists a chat-suggested mermaid graph as a new forked version. Called
// only when the user explicitly clicks "Save this version" — the chat
// itself is stateless. The use case re-runs variable integrity + lint
// on the saved mermaid: the chat agent is already supposed to preserve
// variables and produce well-formed graphs, but the chat response is
// untrusted by the time the user picks one to save (a stale buffer
// could ship to this endpoint).

export interface SaveBraidFromChatCommand {
  promptId: string;
  version: string;
  organizationId: string;
  userId: string;
  mermaidCode: string;
  generatorModel: string;
}

export interface SaveBraidFromChatResult {
  newVersion: string;
  qualityScore: GraphQualityScore;
}

export class SaveBraidFromChatUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly linter: GraphLinter,
    private readonly idGenerator: IIdGenerator,
    private readonly uow: IUnitOfWork,
  ) {}

  async execute(
    command: SaveBraidFromChatCommand,
  ): Promise<SaveBraidFromChatResult> {
    const { prompt, version: source } = await loadPromptAndVersionInOrganization(
      this.prompts,
      this.versions,
      command.promptId,
      command.version,
      command.organizationId,
    );

    const graph = BraidGraph.parse(command.mermaidCode);
    assertVariableIntegrity({
      body: source.sourcePrompt,
      mermaid: graph.mermaidCode,
      variables: source.variables,
    });
    const qualityScore = this.linter.lint(graph);

    return this.uow.run(async () => {
      const label = prompt.allocateNextVersionLabel();
      const forked = PromptVersion.fork({
        source,
        newId: this.idGenerator.newId(),
        newLabel: label,
        initialBraid: {
          graph,
          authorship: BraidAuthorship.byModel(command.generatorModel),
        },
      });
      await this.versions.save(forked);
      await this.prompts.save(prompt);
      return { newVersion: forked.version, qualityScore };
    });
  }
}
