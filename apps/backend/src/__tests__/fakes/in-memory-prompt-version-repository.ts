import type { IPromptVersionRepository } from "../../domain/repositories/prompt-version-repository.js";
import { PromptVersion } from "../../domain/entities/prompt-version.js";
import { PromptVersionAggregateStaleError } from "../../domain/errors/domain-error.js";
import type { InMemoryPromptQueryService } from "./in-memory-prompt-query-service.js";

export class InMemoryPromptVersionRepository implements IPromptVersionRepository {
  private readonly versions = new Map<string, PromptVersion>();
  private readonly storedRevisions = new Map<string, number>();

  constructor(private readonly queryService?: InMemoryPromptQueryService) {}

  async findById(id: string): Promise<PromptVersion | null> {
    return this.versions.get(id) ?? null;
  }

  async findByPromptAndLabel(
    promptId: string,
    label: string,
  ): Promise<PromptVersion | null> {
    for (const version of this.versions.values()) {
      if (version.promptId === promptId && version.version === label) {
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
