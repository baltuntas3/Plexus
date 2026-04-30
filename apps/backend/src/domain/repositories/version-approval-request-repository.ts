import type { VersionApprovalRequest } from "../entities/version-approval-request.js";

// Read-write port for the approval-request aggregate. The infrastructure
// layer enforces a unique partial index on
// `(organizationId, versionId)` for `status = "pending"` so the
// `findActivePendingByVersion` lookup is also the integrity barrier
// that prevents two pending requests against the same version.
export interface IVersionApprovalRequestRepository {
  save(request: VersionApprovalRequest): Promise<void>;
  findById(id: string): Promise<VersionApprovalRequest | null>;
  // Active = `status === "pending"`. Returns at most one because of the
  // unique partial index; callers may rely on that.
  findActivePendingByVersion(
    organizationId: string,
    versionId: string,
  ): Promise<VersionApprovalRequest | null>;
  // Listing is org-wide, not version-scoped, because the approver UI
  // surfaces a single "what is waiting on me" inbox across all prompts
  // in the org. Resolved (approved/rejected/cancelled) rows are filtered
  // out at the projection layer; this port returns only `pending`.
  listPendingByOrganization(
    organizationId: string,
  ): Promise<VersionApprovalRequest[]>;
}
