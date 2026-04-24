import type {
  IPromptQueryService,
  ListPromptSummariesQuery,
  ListVersionSummariesQuery,
  PromptSummary,
  PromptSummaryListResult,
  PromptVersionSummary,
  VersionSummaryListResult,
} from "../../application/queries/prompt-query-service.js";
import { PromptVersion } from "../../domain/entities/prompt-version.js";
import type { Prompt } from "../../domain/entities/prompt.js";

// Test fake that the Prompt aggregate repo writes summaries and versions
// into, keeping read-side snapshots in sync with the write side. Tests call
// `seedFromAggregate` (directly or via the in-memory aggregate repo) to make
// data visible to query-service consumers. All reads return projections,
// not entities — same contract as the Mongo implementation.
export class InMemoryPromptQueryService implements IPromptQueryService {
  private readonly summaries = new Map<string, PromptSummary>();
  private readonly versions = new Map<string, PromptVersionSummary>();

  seedFromAggregate(prompt: Prompt): void {
    const snapshot = prompt.toSnapshot();
    const { prompt: promptState, versions } = snapshot;
    this.summaries.set(promptState.id, {
      id: promptState.id,
      name: promptState.name,
      description: promptState.description,
      taskType: promptState.taskType,
      ownerId: promptState.ownerId,
      productionVersion: promptState.productionVersion,
      createdAt: promptState.createdAt,
      updatedAt: promptState.updatedAt,
    });
    for (const version of versions) {
      const hydrated = PromptVersion.hydrate(version);
      this.versions.set(version.id, toVersionSummary(hydrated));
    }
  }

  seedVersionSummary(version: PromptVersionSummary): void {
    this.versions.set(version.id, version);
  }

  async listPromptSummaries(query: ListPromptSummariesQuery): Promise<PromptSummaryListResult> {
    const owned = [...this.summaries.values()]
      .filter((summary) => summary.ownerId === query.ownerId)
      .filter((summary) =>
        query.search
          ? summary.name.toLowerCase().includes(query.search.toLowerCase())
          : true,
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (query.page - 1) * query.pageSize;
    return { items: owned.slice(start, start + query.pageSize), total: owned.length };
  }

  async findOwnedPromptSummary(
    promptId: string,
    ownerId: string,
  ): Promise<PromptSummary | null> {
    const summary = this.summaries.get(promptId);
    if (!summary || summary.ownerId !== ownerId) {
      return null;
    }
    return { ...summary };
  }

  async findPromptSummariesByIds(
    ids: readonly string[],
  ): Promise<Map<string, PromptSummary>> {
    const result = new Map<string, PromptSummary>();
    for (const id of ids) {
      const summary = this.summaries.get(id);
      if (summary) {
        result.set(id, { ...summary });
      }
    }
    return result;
  }

  async listVersionSummaries(
    query: ListVersionSummariesQuery,
  ): Promise<VersionSummaryListResult> {
    const all = [...this.versions.values()]
      .filter((version) => version.promptId === query.promptId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (query.page - 1) * query.pageSize;
    return { items: all.slice(start, start + query.pageSize), total: all.length };
  }

  async findVersionSummaryById(id: string): Promise<PromptVersionSummary | null> {
    return this.versions.get(id) ?? null;
  }

  async findVersionSummariesByIds(
    ids: readonly string[],
  ): Promise<Map<string, PromptVersionSummary>> {
    const result = new Map<string, PromptVersionSummary>();
    for (const id of ids) {
      const version = this.versions.get(id);
      if (version) {
        result.set(id, version);
      }
    }
    return result;
  }
}

const toVersionSummary = (version: PromptVersion): PromptVersionSummary => {
  const braidGraph = version.braidGraph?.mermaidCode ?? null;
  return {
    id: version.id,
    promptId: version.promptId,
    version: version.version,
    name: version.name,
    sourcePrompt: version.sourcePrompt,
    braidGraph,
    generatorModel: version.generatorModel,
    executablePrompt: version.executablePrompt,
    solverModel: version.solverModel,
    status: version.status,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
  };
};
