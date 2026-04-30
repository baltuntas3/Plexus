import { Organization } from "../../../../domain/entities/organization.js";
import { CreatePromptUseCase } from "../create-prompt.js";
import { CreateVersionUseCase } from "../create-version.js";
import { PromoteVersionUseCase } from "../promote-version.js";
import { InMemoryOrganizationRepository } from "../../../../__tests__/fakes/in-memory-organization-repository.js";
import { InMemoryPromptAggregateRepository } from "../../../../__tests__/fakes/in-memory-prompt-aggregate-repository.js";
import { InMemoryPromptVersionRepository } from "../../../../__tests__/fakes/in-memory-prompt-version-repository.js";
import { InMemoryIdGenerator } from "../../../../__tests__/fakes/in-memory-id-generator.js";
import { NoOpUnitOfWork } from "../../../../__tests__/fakes/no-op-unit-of-work.js";

describe("PromoteVersionUseCase", () => {
  let prompts: InMemoryPromptAggregateRepository;
  let versions: InMemoryPromptVersionRepository;
  let organizations: InMemoryOrganizationRepository;
  let createPrompt: CreatePromptUseCase;
  let createVersion: CreateVersionUseCase;
  let promoteVersion: PromoteVersionUseCase;
  let promptId: string;
  const userId = "user-1";
  const organizationId = "org-1";

  beforeEach(async () => {
    prompts = new InMemoryPromptAggregateRepository();
    versions = new InMemoryPromptVersionRepository();
    organizations = new InMemoryOrganizationRepository();
    const ids = new InMemoryIdGenerator();
    const uow = new NoOpUnitOfWork();
    createPrompt = new CreatePromptUseCase(prompts, versions, ids, uow);
    createVersion = new CreateVersionUseCase(prompts, versions, ids, uow);
    promoteVersion = new PromoteVersionUseCase(prompts, versions, organizations, uow);

    await organizations.save(
      Organization.create({
        organizationId,
        name: "Acme",
        slug: "acme",
        ownerId: userId,
      }),
    );

    const { prompt } = await createPrompt.execute({
      organizationId,
      userId,
      name: "Summarizer",
      description: "",
      taskType: "general",
      initialPrompt: "Summarize the following:",
    });
    promptId = prompt.id;
  });

  it("promotes a draft to staging", async () => {
    const updated = await promoteVersion.execute({
      promptId,
      version: "v1",
      organizationId,
      userId,
      targetStatus: "staging",
    });
    expect(updated.status).toBe("staging");
  });

  it("sets prompt.productionVersionId when promoting to production", async () => {
    await promoteVersion.execute({
      promptId,
      version: "v1",
      organizationId,
      userId,
      targetStatus: "production",
    });
    const prompt = await prompts.findById(promptId);
    const v1 = await versions.findByPromptAndLabelInOrganization(promptId, "v1", organizationId);
    expect(prompt?.productionVersionId).toBe(v1?.id);
  });

  it("demotes previous production to staging when a new version is promoted", async () => {
    await promoteVersion.execute({
      promptId,
      version: "v1",
      organizationId,
      userId,
      targetStatus: "production",
    });

    await createVersion.execute({
      promptId,
      organizationId,
      userId,
      sourcePrompt: "Updated prompt",
    });
    await promoteVersion.execute({
      promptId,
      version: "v2",
      organizationId,
      userId,
      targetStatus: "production",
    });

    const prompt = await prompts.findById(promptId);
    const v1 = await versions.findByPromptAndLabelInOrganization(promptId, "v1", organizationId);
    const v2 = await versions.findByPromptAndLabelInOrganization(promptId, "v2", organizationId);

    expect(v1?.status).toBe("staging");
    expect(v2?.status).toBe("production");
    expect(prompt?.productionVersionId).toBe(v2?.id);
  });

  it("hides other organizations' prompts behind a not-found response (no existence leak)", async () => {
    await expect(
      promoteVersion.execute({
        promptId,
        version: "v1",
        organizationId: "other-org",
        userId: "other-user",
        targetStatus: "staging",
      }),
    ).rejects.toMatchObject({ code: "PROMPT_NOT_FOUND" });
  });

  it("throws PromptVersionNotFoundError for missing version", async () => {
    await expect(
      promoteVersion.execute({
        promptId,
        version: "v99",
        organizationId,
      userId,
        targetStatus: "staging",
      }),
    ).rejects.toMatchObject({ code: "PROMPT_VERSION_NOT_FOUND" });
  });

  it("blocks → production with VERSION_APPROVAL_REQUIRED when org has an approval policy", async () => {
    const org = await organizations.findById(organizationId);
    org!.setApprovalPolicy({ requiredApprovals: 2 });
    await organizations.save(org!);

    await expect(
      promoteVersion.execute({
        promptId,
        version: "v1",
        organizationId,
        userId,
        targetStatus: "production",
      }),
    ).rejects.toMatchObject({ code: "VERSION_APPROVAL_REQUIRED" });
  });

  it("still allows non-production transitions when an approval policy is active", async () => {
    const org = await organizations.findById(organizationId);
    org!.setApprovalPolicy({ requiredApprovals: 2 });
    await organizations.save(org!);

    const updated = await promoteVersion.execute({
      promptId,
      version: "v1",
      organizationId,
      userId,
      targetStatus: "staging",
    });
    expect(updated.status).toBe("staging");
  });

  it("surfaces a typed transition error when demoting back to draft (defense-in-depth)", async () => {
    // The Zod schema at the HTTP boundary rejects `draft` outright; this
    // test simulates a misuse where the use case is called directly (e.g.
    // from another internal caller) to verify the aggregate still guards
    // the rule. The `as never` cast bypasses the static contract since the
    // DTO type now excludes `draft`.
    await promoteVersion.execute({
      promptId,
      version: "v1",
      organizationId,
      userId,
      targetStatus: "staging",
    });
    await expect(
      promoteVersion.execute({
        promptId,
        version: "v1",
        organizationId,
        userId,
        targetStatus: "draft" as never,
      }),
    ).rejects.toMatchObject({
      code: "PROMPT_INVALID_VERSION_TRANSITION",
      details: { from: "staging", to: "draft" },
    });
  });
});
