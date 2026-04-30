import {
  PromptNotFoundError,
  PromptVersionNotFoundError,
} from "../../domain/errors/domain-error.js";
import type { IPromptRepository } from "../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../domain/repositories/prompt-version-repository.js";
import type { VersionApprovalRequest } from "../../domain/entities/version-approval-request.js";
import type { ApprovalRequestDisplayContext } from "./version-approval-projections.js";

// Resolves prompt name + version label for a single approval request.
// Single-row variant used by `request/approve/reject/cancel` use cases
// that need to project exactly one DTO. The list variant
// (`resolveApprovalDisplayContextMap`) batches lookups so the inbox
// projection is N+M reads, not N×2.
export const resolveApprovalDisplayContext = async (
  request: VersionApprovalRequest,
  prompts: IPromptRepository,
  versions: IPromptVersionRepository,
): Promise<ApprovalRequestDisplayContext> => {
  const prompt = await prompts.findInOrganization(
    request.promptId,
    request.organizationId,
  );
  if (!prompt) {
    throw PromptNotFoundError();
  }
  const version = await versions.findInOrganization(
    request.versionId,
    request.organizationId,
  );
  if (!version) {
    throw PromptVersionNotFoundError();
  }
  return { promptName: prompt.name, versionLabel: version.version };
};

// Bulk resolver for the inbox projection. One read per distinct
// prompt + one per distinct version, regardless of how many requests
// share a prompt. The result is a `(requestId → context)` map keyed by
// the approval request id so callers can look up while mapping.
export const resolveApprovalDisplayContextMap = async (
  requests: ReadonlyArray<VersionApprovalRequest>,
  prompts: IPromptRepository,
  versions: IPromptVersionRepository,
): Promise<Map<string, ApprovalRequestDisplayContext>> => {
  if (requests.length === 0) return new Map();
  const organizationId = requests[0]!.organizationId;

  const promptIds = new Set(requests.map((r) => r.promptId));
  const versionIds = new Set(requests.map((r) => r.versionId));

  const promptEntries = await Promise.all(
    Array.from(promptIds).map(async (id) => {
      const prompt = await prompts.findInOrganization(id, organizationId);
      return [id, prompt?.name ?? null] as const;
    }),
  );
  const versionEntries = await Promise.all(
    Array.from(versionIds).map(async (id) => {
      const version = await versions.findInOrganization(id, organizationId);
      return [id, version?.version ?? null] as const;
    }),
  );

  const promptNames = new Map(promptEntries);
  const versionLabels = new Map(versionEntries);

  const map = new Map<string, ApprovalRequestDisplayContext>();
  for (const r of requests) {
    // Missing prompt/version is an integrity anomaly (request was
    // created with valid ids; rows aren't deleted). Surface as empty
    // strings so the row still renders rather than dropping a pending
    // approval from the approver's inbox.
    map.set(r.id, {
      promptName: promptNames.get(r.promptId) ?? "(missing prompt)",
      versionLabel: versionLabels.get(r.versionId) ?? "(missing version)",
    });
  }
  return map;
};
