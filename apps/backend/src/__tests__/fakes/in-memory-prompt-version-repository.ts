import type { VersionStatus } from "@plexus/shared-types";
import type {
  CreateVersionInput,
  IPromptVersionRepository,
  ListVersionsQuery,
  VersionListResult,
} from "../../domain/repositories/prompt-version-repository.js";
import type { PromptVersion } from "../../domain/entities/prompt-version.js";

export class InMemoryPromptVersionRepository implements IPromptVersionRepository {
  private readonly versions = new Map<string, PromptVersion>();
  private nextId = 1;

  async create(input: CreateVersionInput): Promise<PromptVersion> {
    const now = new Date();
    const id = String(this.nextId++);
    const version: PromptVersion = {
      id,
      promptId: input.promptId,
      version: input.version,
      classicalPrompt: input.classicalPrompt,
      braidGraph: null,
      generatorModel: null,
      solverModel: null,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };
    this.versions.set(id, version);
    return version;
  }

  async findById(id: string): Promise<PromptVersion | null> {
    return this.versions.get(id) ?? null;
  }

  async findByPromptAndVersion(promptId: string, version: string): Promise<PromptVersion | null> {
    for (const v of this.versions.values()) {
      if (v.promptId === promptId && v.version === version) return v;
    }
    return null;
  }

  async list(query: ListVersionsQuery): Promise<VersionListResult> {
    const items = [...this.versions.values()].filter((v) => v.promptId === query.promptId);
    const start = (query.page - 1) * query.pageSize;
    return { items: items.slice(start, start + query.pageSize), total: items.length };
  }

  async countByPrompt(promptId: string): Promise<number> {
    return [...this.versions.values()].filter((v) => v.promptId === promptId).length;
  }

  async findCurrentByStatus(
    promptId: string,
    status: VersionStatus,
  ): Promise<PromptVersion | null> {
    for (const v of this.versions.values()) {
      if (v.promptId === promptId && v.status === status) return v;
    }
    return null;
  }

  async updateStatus(id: string, status: VersionStatus): Promise<void> {
    const version = this.versions.get(id);
    if (!version) return;
    this.versions.set(id, { ...version, status, updatedAt: new Date() });
  }

  async setBraidGraph(id: string, braidGraph: string, generatorModel: string): Promise<void> {
    const version = this.versions.get(id);
    if (!version) return;
    this.versions.set(id, {
      ...version,
      braidGraph,
      generatorModel,
      updatedAt: new Date(),
    });
  }
}
