import type { VersionStatus } from "@plexus/shared-types";

export interface PromptVersion {
  id: string;
  promptId: string;
  version: string;
  classicalPrompt: string;
  braidGraph: string | null;
  generatorModel: string | null;
  solverModel: string | null;
  status: VersionStatus;
  createdAt: Date;
  updatedAt: Date;
}
