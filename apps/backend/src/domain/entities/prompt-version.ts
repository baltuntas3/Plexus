import type { VersionStatus } from "@plexus/shared-types";

export interface PromptVersion {
  id: string;
  promptId: string;
  version: string;
  // Human-friendly label set by the owner (e.g. "baseline", "with-safety").
  // Null until the user names it — callers should fall back to `version` for
  // display when this is null.
  name: string | null;
  classicalPrompt: string;
  braidGraph: string | null;
  generatorModel: string | null;
  solverModel: string | null;
  status: VersionStatus;
  createdAt: Date;
  updatedAt: Date;
}
