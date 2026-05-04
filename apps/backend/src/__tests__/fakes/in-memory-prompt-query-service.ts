import type {
  IPromptQueryService,
  ListPromptSummariesQuery,
  ListVersionSummariesInOrgQuery,
  PromptSummary,
  PromptSummaryListResult,
  PromptVersionSummary,
  VersionSummaryListResult,
} from "../../application/queries/prompt-query-service.js";
import { versionToSummary } from "../../application/queries/prompt-projections.js";
import { PromptVersion } from "../../domain/entities/prompt-version.js";
import type { Prompt } from "../../domain/entities/prompt.js";

// Read-side test fake. Seed hooks mirror what the Mongo query service
// resolves from the persistence layer: the Prompt root contributes the
// summary fields plus `productionVersionId`; versions are seeded separately
// (previously the Prompt aggregate carried them, now they are their own
// aggregate). Production label is resolved at read time by joining the
// seeded version map.
export class InMemoryPromptQueryService implements IPromptQueryService {
  private readonly summaries = new Map<
    string,
    { summary: Omit<PromptSummary, "productionVersion">; productionVersionId: string | null }
  >();
  private readonly versions = new Map<string, PromptVersionSummary>();

  seedPromptRoot(prompt: Prompt): void {
    this.summaries.set(prompt.id, {
      summary: {
        id: prompt.id,
        name: prompt.name,
        description: prompt.description,
        taskType: prompt.taskType,
        organizationId: prompt.organizationId,
        creatorId: prompt.creatorId,
        createdAt: prompt.createdAt,
        updatedAt: prompt.updatedAt,
      },
      productionVersionId: prompt.productionVersionId,
    });
  }

  seedVersion(version: PromptVersion): void {
    this.versions.set(version.id, versionToSummary(version));
  }

  seedPromptSummary(summary: PromptSummary): void {
    // Used by tests that construct summaries directly without a Prompt
    // aggregate. We stash the label on `productionVersionId` as a key into
    // the versions map only when it corresponds to a seeded version; for
    // standalone summary seeding we just echo the label back at read time.
    this.summaries.set(summary.id, {
      summary: {
        id: summary.id,
        name: summary.name,
        description: summary.description,
        taskType: summary.taskType,
        organizationId: summary.organizationId,
        creatorId: summary.creatorId,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
      },
      productionVersionId: summary.productionVersion,
    });
  }

  seedVersionSummary(version: PromptVersionSummary): void {
    this.versions.set(version.id, version);
  }

  private project(
    entry: { summary: Omit<PromptSummary, "productionVersion">; productionVersionId: string | null },
  ): PromptSummary {
    // productionVersionId may be either a real id (seeded via aggregate) or
    // a label (seeded via raw summary); try id first, fall back to label.
    let productionVersion: string | null = null;
    if (entry.productionVersionId) {
      const asVersion = this.versions.get(entry.productionVersionId);
      productionVersion = asVersion?.version ?? entry.productionVersionId;
    }
    return { ...entry.summary, productionVersion };
  }

  async listPromptSummaries(query: ListPromptSummariesQuery): Promise<PromptSummaryListResult> {
    const owned = [...this.summaries.values()]
      .filter((entry) => entry.summary.organizationId === query.organizationId)
      .filter((entry) =>
        query.search
          ? entry.summary.name.toLowerCase().includes(query.search.toLowerCase())
          : true,
      )
      .sort((a, b) => b.summary.createdAt.getTime() - a.summary.createdAt.getTime())
      .map((entry) => this.project(entry));
    const start = (query.page - 1) * query.pageSize;
    return { items: owned.slice(start, start + query.pageSize), total: owned.length };
  }

  async findPromptSummaryInOrganization(
    promptId: string,
    organizationId: string,
  ): Promise<PromptSummary | null> {
    const entry = this.summaries.get(promptId);
    if (!entry || entry.summary.organizationId !== organizationId) return null;
    return this.project(entry);
  }

  async findPromptSummariesByIdsInOrganization(
    ids: readonly string[],
    organizationId: string,
  ): Promise<Map<string, PromptSummary>> {
    const result = new Map<string, PromptSummary>();
    for (const id of ids) {
      const entry = this.summaries.get(id);
      if (entry && entry.summary.organizationId === organizationId) {
        result.set(id, this.project(entry));
      }
    }
    return result;
  }

  async listVersionSummariesInOrganization(
    query: ListVersionSummariesInOrgQuery,
  ): Promise<VersionSummaryListResult | null> {
    const entry = this.summaries.get(query.promptId);
    if (!entry || entry.summary.organizationId !== query.organizationId) return null;
    const all = [...this.versions.values()]
      .filter((version) => version.promptId === query.promptId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (query.page - 1) * query.pageSize;
    return { items: all.slice(start, start + query.pageSize), total: all.length };
  }

  async findVersionByLabelInOrganization(
    promptId: string,
    label: string,
    organizationId: string,
  ): Promise<PromptVersionSummary | null> {
    const entry = this.summaries.get(promptId);
    if (!entry || entry.summary.organizationId !== organizationId) return null;
    const match = [...this.versions.values()].find(
      (version) => version.promptId === promptId && version.version === label,
    );
    return match ?? null;
  }

  async findVersionSummariesByIdsInOrganization(
    ids: readonly string[],
    organizationId: string,
  ): Promise<Map<string, PromptVersionSummary>> {
    const result = new Map<string, PromptVersionSummary>();
    for (const id of ids) {
      const version = this.versions.get(id);
      if (!version) continue;
      const entry = this.summaries.get(version.promptId);
      if (!entry || entry.summary.organizationId !== organizationId) continue;
      result.set(id, version);
    }
    return result;
  }
}
