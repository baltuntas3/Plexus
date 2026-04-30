import type { VersionApprovalRequest } from "../../../domain/entities/version-approval-request.js";
import { VersionApprovalRequestNotFoundError } from "../../../domain/errors/domain-error.js";
import type { IVersionApprovalRequestRepository } from "../../../domain/repositories/version-approval-request-repository.js";

// Loads an approval request scoped to the caller's organization, or
// throws. Cross-org ids collapse to NOT_FOUND so existence does not leak
// via id enumeration — same convention as `loadPromptInOrganization`.
// Centralized so the three voting use cases (approve / reject / cancel)
// don't each re-derive the scoping rule.
export const loadApprovalRequestInOrganization = async (
  approvals: IVersionApprovalRequestRepository,
  requestId: string,
  organizationId: string,
): Promise<VersionApprovalRequest> => {
  const request = await approvals.findById(requestId);
  if (!request || request.organizationId !== organizationId) {
    throw VersionApprovalRequestNotFoundError();
  }
  return request;
};
