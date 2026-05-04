import {
  PromptVersionNotFoundError,
  ValidationError,
} from "../../../domain/errors/domain-error.js";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { VersionVariablesDiffDto } from "@plexus/shared-types";
import type { PromptVersionSummary } from "../../queries/prompt-query-service.js";
import { versionToSummary } from "../../queries/prompt-projections.js";
import { computeVariablesDiff } from "../../services/diff/variables-diff.js";
import { loadPromptInOrganization } from "./load-owned-prompt.js";

interface CompareVersionsCommand {
  promptId: string;
  organizationId: string;
  // Conventionally the "older" or "left-side" version label.
  baseVersion: string;
  // Conventionally the "newer" or "right-side" version label.
  targetVersion: string;
}

// Application-side projection: presentation maps the inner versions to
// `PromptVersionDto` via the existing `toPromptVersionDto` mapper, and
// forwards `variablesDiff` as-is.
interface VersionComparisonResult {
  base: PromptVersionSummary;
  target: PromptVersionSummary;
  variablesDiff: VersionVariablesDiffDto;
}

// Side-by-side comparison of two versions in the same prompt root. The
// two reads happen back-to-back (not in a UoW): comparison is read-
// only and a tiny window where the two versions snapshot at slightly
// different revisions is acceptable — the result is informational, not
// a write target.
//
// Body and graph diffs are not produced here: the UI renders Monaco's
// DiffEditor against `base.sourcePrompt` / `target.sourcePrompt` and a
// text-based mermaid diff against `base.braidGraph` / `target.braidGraph`.
// Variables diff IS pre-computed because it has set-semantic matching
// rules that must stay deterministic across UI surfaces.
export class CompareVersionsUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
  ) {}

  async execute(
    command: CompareVersionsCommand,
  ): Promise<VersionComparisonResult> {
    if (command.baseVersion === command.targetVersion) {
      // The UI offers a "Compare with" picker that excludes the current
      // version, so this only fires under a hand-crafted request — but
      // self-comparison would be a meaningless empty diff and we surface
      // it as validation rather than silently returning empty.
      throw ValidationError(
        "Cannot compare a version with itself; pick two different versions",
      );
    }

    // Org-scope is enforced once at the prompt root; both versions
    // belong to that root by construction (`findByPromptAndLabel`
    // matches on promptId), so we don't need to re-load the prompt
    // for the second version. The two version reads run in parallel.
    await loadPromptInOrganization(
      this.prompts,
      command.promptId,
      command.organizationId,
    );
    const [base, target] = await Promise.all([
      this.versions.findByPromptAndLabelInOrganization(
        command.promptId,
        command.baseVersion,
        command.organizationId,
      ),
      this.versions.findByPromptAndLabelInOrganization(
        command.promptId,
        command.targetVersion,
        command.organizationId,
      ),
    ]);
    if (!base) {
      throw PromptVersionNotFoundError(command.baseVersion);
    }
    if (!target) {
      throw PromptVersionNotFoundError(command.targetVersion);
    }

    const baseSummary = versionToSummary(base);
    const targetSummary = versionToSummary(target);

    return {
      base: baseSummary,
      target: targetSummary,
      variablesDiff: computeVariablesDiff(
        baseSummary.variables,
        targetSummary.variables,
      ),
    };
  }
}
