import type {
  IPromptQueryService,
  ListPromptSummariesQuery,
  PromptSummary,
  PromptSummaryListResult,
} from "../../application/queries/prompt-query-service.js";
import { PromptVersion } from "../../domain/entities/prompt-version.js";
import type { Prompt } from "../../domain/entities/prompt.js";

// Test fake that the Prompt aggregate repo writes summaries and versions
// into, keeping read-side snapshots in sync with the write side. Tests call
// `seedFromAggregate` (directly or via the in-memory aggregate repo) to make
// data visible to query-service consumers.
export class InMemoryPromptQueryService implements IPromptQueryService {
  private readonly summaries = new Map<string, PromptSummary>();
  private readonly versions = new Map<string, PromptVersion>();

  seedFromAggregate(prompt: Prompt): void {
    const { prompt: summary, versions } = prompt.toPrimitives();
    this.summaries.set(summary.id, { ...summary });
    for (const version of versions) {
      this.versions.set(version.id, PromptVersion.hydrate(version));
    }
  }

  seedVersion(version: PromptVersion): void {
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

  async findVersionById(id: string): Promise<PromptVersion | null> {
    return this.versions.get(id) ?? null;
  }

  async findVersionsByIds(ids: readonly string[]): Promise<Map<string, PromptVersion>> {
    const result = new Map<string, PromptVersion>();
    for (const id of ids) {
      const version = this.versions.get(id);
      if (version) {
        result.set(id, version);
      }
    }
    return result;
  }
}
