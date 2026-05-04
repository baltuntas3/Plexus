import { Organization } from "../../../../domain/entities/organization.js";
import { ApproveVersionRequestUseCase } from "../approve-version-request.js";
import { CancelVersionRequestUseCase } from "../cancel-version-request.js";
import { ListPendingApprovalRequestsUseCase } from "../list-pending-approval-requests.js";
import { RejectVersionRequestUseCase } from "../reject-version-request.js";
import { RequestVersionApprovalUseCase } from "../request-version-approval.js";
import { SetApprovalPolicyUseCase } from "../set-approval-policy.js";
import { CreatePromptUseCase } from "../../prompts/create-prompt.js";
import { CreateVersionUseCase } from "../../prompts/create-version.js";
import { PromoteVersionUseCase } from "../../prompts/promote-version.js";
import { InMemoryIdGenerator } from "../../../../__tests__/fakes/in-memory-id-generator.js";
import { InMemoryOrganizationRepository } from "../../../../__tests__/fakes/in-memory-organization-repository.js";
import { InMemoryPromptAggregateRepository } from "../../../../__tests__/fakes/in-memory-prompt-aggregate-repository.js";
import { InMemoryPromptVersionRepository } from "../../../../__tests__/fakes/in-memory-prompt-version-repository.js";
import { InMemoryVersionApprovalRequestRepository } from "../../../../__tests__/fakes/in-memory-version-approval-request-repository.js";
import { NoOpUnitOfWork } from "../../../../__tests__/fakes/no-op-unit-of-work.js";

const organizationId = "org-1";
const requesterId = "u-requester";

const setup = async () => {
  const organizations = new InMemoryOrganizationRepository();
  const prompts = new InMemoryPromptAggregateRepository();
  const versions = new InMemoryPromptVersionRepository();
  const approvals = new InMemoryVersionApprovalRequestRepository();
  const ids = new InMemoryIdGenerator();
  const uow = new NoOpUnitOfWork();

  await organizations.save(
    Organization.create({
      organizationId,
      name: "Acme",
      slug: "acme",
      ownerId: requesterId,
    }),
  );

  const createPrompt = new CreatePromptUseCase(prompts, versions, ids, uow);
  const createVersion = new CreateVersionUseCase(prompts, versions, ids, uow);
  const promoteVersion = new PromoteVersionUseCase(
    prompts,
    versions,
    organizations,
    uow,
  );

  const { prompt } = await createPrompt.execute({
    organizationId,
    userId: requesterId,
    name: "Summarizer",
    description: "",
    taskType: "general",
    initialPrompt: "Summarize the input.",
  });

  return {
    organizations,
    prompts,
    versions,
    approvals,
    promptId: prompt.id,
    createVersion,
    promoteVersion,
    setPolicy: new SetApprovalPolicyUseCase(organizations),
    requestApproval: new RequestVersionApprovalUseCase(
      organizations,
      prompts,
      versions,
      approvals,
      ids,
    ),
    approve: new ApproveVersionRequestUseCase(approvals, prompts, versions, uow),
    reject: new RejectVersionRequestUseCase(approvals, prompts, versions),
    cancel: new CancelVersionRequestUseCase(approvals, prompts, versions),
    listPending: new ListPendingApprovalRequestsUseCase(
      approvals,
      prompts,
      versions,
    ),
  };
};

const enablePolicy = async (
  organizations: InMemoryOrganizationRepository,
  requiredApprovals: number,
) => {
  const org = await organizations.findById(organizationId);
  org!.setApprovalPolicy({ requiredApprovals });
  await organizations.save(org!);
};

describe("SetApprovalPolicy", () => {
  it("installs the policy and returns the full updated org DTO", async () => {
    const { setPolicy, organizations } = await setup();
    const result = await setPolicy.execute({
      organizationId,
      requiredApprovals: 2,
    });
    expect(result.id).toBe(organizationId);
    expect(result.approvalPolicy).toEqual({ requiredApprovals: 2 });
    const reloaded = await organizations.findById(organizationId);
    expect(reloaded?.approvalPolicy?.requiredApprovals).toBe(2);
  });

  it("clearing with null re-enables direct → production promotion", async () => {
    const { setPolicy, promoteVersion, organizations, promptId } = await setup();
    await setPolicy.execute({ organizationId, requiredApprovals: 2 });
    await setPolicy.execute({ organizationId, requiredApprovals: null });

    const reloaded = await organizations.findById(organizationId);
    expect(reloaded?.approvalPolicy).toBeNull();

    const updated = await promoteVersion.execute({
      promptId,
      version: "v1",
      organizationId,
      targetStatus: "production",
    });
    expect(updated.status).toBe("production");
  });

  it("rejects out-of-range thresholds via the entity invariant", async () => {
    const { setPolicy } = await setup();
    await expect(
      setPolicy.execute({ organizationId, requiredApprovals: 0 }),
    ).rejects.toThrow(/between/);
  });
});

describe("RequestVersionApproval", () => {
  it("issues a pending request capturing the policy threshold", async () => {
    const { organizations, requestApproval, promptId } = await setup();
    await enablePolicy(organizations, 2);

    const request = await requestApproval.execute({
      organizationId,
      actorUserId: requesterId,
      promptId,
      version: "v1",
    });
    expect(request.status).toBe("pending");
    expect(request.requiredApprovals).toBe(2);
    expect(request.approvals).toEqual([]);
    // Display context resolved server-side so approver inboxes can
    // render the prompt by name + version label without a fan-out
    // fetch.
    expect(request.promptName).toBe("Summarizer");
    expect(request.versionLabel).toBe("v1");
  });

  it("rejects when the org has no approval policy", async () => {
    const { requestApproval, promptId } = await setup();
    await expect(
      requestApproval.execute({
        organizationId,
        actorUserId: requesterId,
        promptId,
        version: "v1",
      }),
    ).rejects.toMatchObject({ code: "VERSION_APPROVAL_NOT_ENABLED" });
  });

  it("rejects a second concurrent pending request against the same version", async () => {
    const { organizations, requestApproval, promptId } = await setup();
    await enablePolicy(organizations, 2);
    await requestApproval.execute({
      organizationId,
      actorUserId: requesterId,
      promptId,
      version: "v1",
    });
    await expect(
      requestApproval.execute({
        organizationId,
        actorUserId: requesterId,
        promptId,
        version: "v1",
      }),
    ).rejects.toMatchObject({ code: "VERSION_APPROVAL_REQUEST_ALREADY_PENDING" });
  });

  it("collapses cross-org promptIds to PROMPT_NOT_FOUND", async () => {
    const { organizations, requestApproval, promptId } = await setup();
    await enablePolicy(organizations, 2);
    await expect(
      requestApproval.execute({
        organizationId: "other-org",
        actorUserId: requesterId,
        promptId,
        version: "v1",
      }),
    ).rejects.toMatchObject({ code: "ORGANIZATION_NOT_FOUND" });
  });
});

describe("ApproveVersionRequest", () => {
  it("auto-promotes to production when the threshold is reached", async () => {
    const {
      organizations,
      requestApproval,
      approve,
      prompts,
      versions,
      promptId,
    } = await setup();
    await enablePolicy(organizations, 2);

    const requested = await requestApproval.execute({
      organizationId,
      actorUserId: requesterId,
      promptId,
      version: "v1",
    });

    const afterFirst = await approve.execute({
      organizationId,
      actorUserId: "u-approver-a",
      requestId: requested.id,
    });
    expect(afterFirst.status).toBe("pending");
    // Vote responses also carry resolved display context.
    expect(afterFirst.promptName).toBe("Summarizer");
    expect(afterFirst.versionLabel).toBe("v1");

    const afterSecond = await approve.execute({
      organizationId,
      actorUserId: "u-approver-b",
      requestId: requested.id,
    });
    expect(afterSecond.status).toBe("approved");
    expect(afterSecond.resolvedAt).not.toBeNull();

    const v1 = await versions.findByPromptAndLabelInOrganization(promptId, "v1", organizationId);
    const prompt = await prompts.findInOrganization(promptId, organizationId);
    expect(v1?.status).toBe("production");
    expect(prompt?.productionVersionId).toBe(v1?.id);
  });

  it("demotes the previous production version when a new one is approved", async () => {
    const {
      organizations,
      requestApproval,
      approve,
      promoteVersion,
      createVersion,
      prompts,
      versions,
      promptId,
    } = await setup();

    // Promote v1 directly first (no policy yet), then enable policy and
    // approve a second version. The auto-promote must demote v1.
    await promoteVersion.execute({
      promptId,
      version: "v1",
      organizationId,
      targetStatus: "production",
    });
    await enablePolicy(organizations, 1);

    await createVersion.execute({
      promptId,
      organizationId,
      sourcePrompt: "v2 body",
    });
    const requested = await requestApproval.execute({
      organizationId,
      actorUserId: requesterId,
      promptId,
      version: "v2",
    });
    await approve.execute({
      organizationId,
      actorUserId: "u-approver-a",
      requestId: requested.id,
    });

    const v1 = await versions.findByPromptAndLabelInOrganization(promptId, "v1", organizationId);
    const v2 = await versions.findByPromptAndLabelInOrganization(promptId, "v2", organizationId);
    const prompt = await prompts.findInOrganization(promptId, organizationId);
    expect(v1?.status).toBe("staging");
    expect(v2?.status).toBe("production");
    expect(prompt?.productionVersionId).toBe(v2?.id);
  });

  it("rejects self-approval by the requester", async () => {
    const { organizations, requestApproval, approve, promptId } = await setup();
    await enablePolicy(organizations, 2);
    const requested = await requestApproval.execute({
      organizationId,
      actorUserId: requesterId,
      promptId,
      version: "v1",
    });
    await expect(
      approve.execute({
        organizationId,
        actorUserId: requesterId,
        requestId: requested.id,
      }),
    ).rejects.toMatchObject({ code: "VERSION_APPROVAL_REQUEST_SELF_APPROVAL" });
  });

  it("rejects duplicate approve from the same user", async () => {
    const { organizations, requestApproval, approve, promptId } = await setup();
    await enablePolicy(organizations, 3);
    const requested = await requestApproval.execute({
      organizationId,
      actorUserId: requesterId,
      promptId,
      version: "v1",
    });
    await approve.execute({
      organizationId,
      actorUserId: "u-approver-a",
      requestId: requested.id,
    });
    await expect(
      approve.execute({
        organizationId,
        actorUserId: "u-approver-a",
        requestId: requested.id,
      }),
    ).rejects.toMatchObject({ code: "VERSION_APPROVAL_REQUEST_DUPLICATE_VOTE" });
  });

  it("collapses cross-org requestId to NOT_FOUND", async () => {
    const { organizations, requestApproval, approve, promptId } = await setup();
    await enablePolicy(organizations, 2);
    const requested = await requestApproval.execute({
      organizationId,
      actorUserId: requesterId,
      promptId,
      version: "v1",
    });
    await expect(
      approve.execute({
        organizationId: "other-org",
        actorUserId: "u-approver-a",
        requestId: requested.id,
      }),
    ).rejects.toMatchObject({ code: "VERSION_APPROVAL_REQUEST_NOT_FOUND" });
  });
});

describe("RejectVersionRequest", () => {
  it("a single rejection resolves the request and leaves the version unchanged", async () => {
    const {
      organizations,
      requestApproval,
      reject,
      versions,
      promptId,
    } = await setup();
    await enablePolicy(organizations, 3);
    const requested = await requestApproval.execute({
      organizationId,
      actorUserId: requesterId,
      promptId,
      version: "v1",
    });
    const result = await reject.execute({
      organizationId,
      actorUserId: "u-approver-a",
      requestId: requested.id,
    });
    expect(result.status).toBe("rejected");
    expect(result.rejections.map((v) => v.userId)).toEqual(["u-approver-a"]);
    // Reject path resolves display context via the single resolver.
    expect(result.promptName).toBe("Summarizer");
    expect(result.versionLabel).toBe("v1");

    const v1 = await versions.findByPromptAndLabelInOrganization(promptId, "v1", organizationId);
    expect(v1?.status).toBe("draft");
  });
});

describe("CancelVersionRequest", () => {
  it("the requester can cancel their own request without admin power", async () => {
    const { organizations, requestApproval, cancel, promptId } = await setup();
    await enablePolicy(organizations, 2);
    const requested = await requestApproval.execute({
      organizationId,
      actorUserId: requesterId,
      promptId,
      version: "v1",
    });
    const result = await cancel.execute({
      organizationId,
      actorUserId: requesterId,
      requestId: requested.id,
      canCancelAny: false,
    });
    expect(result.status).toBe("cancelled");
    expect(result.promptName).toBe("Summarizer");
    expect(result.versionLabel).toBe("v1");
  });

  it("rejects cancellation by a non-requester without admin power", async () => {
    const { organizations, requestApproval, cancel, promptId } = await setup();
    await enablePolicy(organizations, 2);
    const requested = await requestApproval.execute({
      organizationId,
      actorUserId: requesterId,
      promptId,
      version: "v1",
    });
    await expect(
      cancel.execute({
        organizationId,
        actorUserId: "u-someone-else",
        requestId: requested.id,
        canCancelAny: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin (canCancelAny=true) can cancel another user's request", async () => {
    const { organizations, requestApproval, cancel, promptId } = await setup();
    await enablePolicy(organizations, 2);
    const requested = await requestApproval.execute({
      organizationId,
      actorUserId: requesterId,
      promptId,
      version: "v1",
    });
    const result = await cancel.execute({
      organizationId,
      actorUserId: "u-admin",
      requestId: requested.id,
      canCancelAny: true,
    });
    expect(result.status).toBe("cancelled");
  });
});

describe("ListPendingApprovalRequests", () => {
  it("returns only pending requests in the org, newest first, with resolved display context", async () => {
    const {
      organizations,
      requestApproval,
      reject,
      createVersion,
      listPending,
      promptId,
    } = await setup();
    await enablePolicy(organizations, 3);

    const r1 = await requestApproval.execute({
      organizationId,
      actorUserId: requesterId,
      promptId,
      version: "v1",
    });
    await reject.execute({
      organizationId,
      actorUserId: "u-approver-a",
      requestId: r1.id,
    });

    await createVersion.execute({
      promptId,
      organizationId,
      sourcePrompt: "v2 body",
    });
    const r2 = await requestApproval.execute({
      organizationId,
      actorUserId: requesterId,
      promptId,
      version: "v2",
    });

    const pending = await listPending.execute({ organizationId });
    expect(pending.map((r) => r.id)).toEqual([r2.id]);
    // The bulk resolver path populates promptName/versionLabel for
    // every row in the inbox so the approver UI renders names, not ids.
    expect(pending[0]?.promptName).toBe("Summarizer");
    expect(pending[0]?.versionLabel).toBe("v2");
  });
});
