import type { IPromptVersionRepository } from "../../domain/repositories/prompt-version-repository.js";
import { PromptVersion } from "../../domain/entities/prompt-version.js";
import { PromptVersionAggregateStaleError } from "../../domain/errors/domain-error.js";
import type { InMemoryPromptQueryService } from "./in-memory-prompt-query-service.js";

export class InMemoryPromptVersionRepository implements IPromptVersionRepository {
  private readonly versions = new Map<string, PromptVersion>();
  private readonly storedRevisions = new Map<string, number>();

  constructor(private readonly queryService?: InMemoryPromptQueryService) {}

  async findInOrganization(
    id: string,
    organizationId: string,
  ): Promise<PromptVersion | null> {
    const v = this.versions.get(id);
    if (!v) return null;
    return v.organizationId === organizationId ? v : null;
  }

  async findByPromptAndLabelInOrganization(
    promptId: string,
    label: string,
    organizationId: string,
  ): Promise<PromptVersion | null> {
    for (const version of this.versions.values()) {
      if (
        version.promptId === promptId &&
        version.version === label &&
        version.organizationId === organizationId
      ) {
        return version;
      }
    }
    return null;
  }

  async save(version: PromptVersion): Promise<void> {
    const { primitives, expectedRevision } = version.toSnapshot();
    const stored = this.storedRevisions.get(version.id);
    if (stored !== undefined && stored !== expectedRevision) {
      throw PromptVersionAggregateStaleError();
    }
    const hydrated = PromptVersion.hydrate(primitives);
    this.versions.set(version.id, hydrated);
    this.storedRevisions.set(version.id, primitives.revision);
    this.queryService?.seedVersion(hydrated);
    version.markPersisted();
  }
}
