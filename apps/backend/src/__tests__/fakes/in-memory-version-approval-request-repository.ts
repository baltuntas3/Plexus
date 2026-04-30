import type { IVersionApprovalRequestRepository } from "../../domain/repositories/version-approval-request-repository.js";
import {
  VersionApprovalRequest,
  type VersionApprovalRequestPrimitives,
} from "../../domain/entities/version-approval-request.js";
import {
  VersionApprovalRequestAggregateStaleError,
  VersionApprovalRequestAlreadyPendingError,
} from "../../domain/errors/domain-error.js";
import { assertOptimisticConcurrency } from "./assert-optimistic-concurrency.js";

// Mirrors `MongoVersionApprovalRequestRepository`: enforces the partial
// unique index on `(organizationId, versionId)` for `status = "pending"`
// so use-case tests catch the same concurrency edge as production.
export class InMemoryVersionApprovalRequestRepository
  implements IVersionApprovalRequestRepository
{
  private readonly requests = new Map<string, VersionApprovalRequestPrimitives>();

  async findById(id: string): Promise<VersionApprovalRequest | null> {
    const data = this.requests.get(id);
    return data ? VersionApprovalRequest.hydrate({ ...data }) : null;
  }

  async findActivePendingByVersion(
    organizationId: string,
    versionId: string,
  ): Promise<VersionApprovalRequest | null> {
    for (const data of this.requests.values()) {
      if (
        data.organizationId === organizationId
        && data.versionId === versionId
        && data.status === "pending"
      ) {
        return VersionApprovalRequest.hydrate({ ...data });
      }
    }
    return null;
  }

  async listPendingByOrganization(
    organizationId: string,
  ): Promise<VersionApprovalRequest[]> {
    return Array.from(this.requests.values())
      .filter((d) => d.organizationId === organizationId && d.status === "pending")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((d) => VersionApprovalRequest.hydrate({ ...d }));
  }

  async save(request: VersionApprovalRequest): Promise<void> {
    const { primitives, expectedRevision } = request.toSnapshot();
    const stored = this.requests.get(primitives.id);

    assertOptimisticConcurrency(
      stored?.revision,
      expectedRevision,
      VersionApprovalRequestAggregateStaleError,
    );

    // Partial unique on `(orgId, versionId)` where status="pending"; only
    // checked on first insert because in-place updates cannot create a
    // second pending row for the same target.
    if (expectedRevision === 0 && primitives.status === "pending") {
      for (const other of this.requests.values()) {
        if (
          other.organizationId === primitives.organizationId
          && other.versionId === primitives.versionId
          && other.status === "pending"
        ) {
          throw VersionApprovalRequestAlreadyPendingError();
        }
      }
    }

    this.requests.set(primitives.id, {
      ...primitives,
      approvals: [...primitives.approvals],
      rejections: [...primitives.rejections],
    });
    request.markPersisted();
  }
}
