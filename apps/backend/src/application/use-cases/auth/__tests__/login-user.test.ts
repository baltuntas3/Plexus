import { LoginUserUseCase } from "../login-user.js";
import { Organization } from "../../../../domain/entities/organization.js";
import { OrganizationMember } from "../../../../domain/entities/organization-member.js";
import { InMemoryUserRepository } from "../../../../__tests__/fakes/in-memory-user-repository.js";
import { InMemoryOrganizationRepository } from "../../../../__tests__/fakes/in-memory-organization-repository.js";
import { InMemoryOrganizationMemberRepository } from "../../../../__tests__/fakes/in-memory-organization-member-repository.js";
import {
  FakePasswordHasher,
  FakeTokenService,
} from "../../../../__tests__/fakes/fake-services.js";

describe("LoginUserUseCase", () => {
  let users: InMemoryUserRepository;
  let memberships: InMemoryOrganizationMemberRepository;
  let organizations: InMemoryOrganizationRepository;
  let hasher: FakePasswordHasher;
  let tokens: FakeTokenService;
  let useCase: LoginUserUseCase;
  let userId: string;

  beforeEach(async () => {
    users = new InMemoryUserRepository();
    memberships = new InMemoryOrganizationMemberRepository();
    organizations = new InMemoryOrganizationRepository();
    hasher = new FakePasswordHasher();
    tokens = new FakeTokenService();
    useCase = new LoginUserUseCase(
      users,
      memberships,
      organizations,
      hasher,
      tokens,
    );

    const created = await users.create({
      email: "alice@example.com",
      name: "Alice",
      passwordHash: await hasher.hash("secret123"),
    });
    userId = created.id;

    // Seed the canonical "user has one organization" state. Login picks
    // the first membership, so the active org claim is deterministic.
    const org = Organization.create({
      organizationId: "org-1",
      name: "Acme",
      slug: "acme",
      ownerId: userId,
    });
    await organizations.save(org);
    const member = OrganizationMember.create({
      id: "m-1",
      organizationId: "org-1",
      userId,
      role: "owner",
    });
    await memberships.save(member);
  });

  it("returns user, organization, and tokens on valid credentials", async () => {
    const result = await useCase.execute({
      email: "alice@example.com",
      password: "secret123",
    });

    expect(result.user.email).toBe("alice@example.com");
    expect(result.organization.id).toBe("org-1");
    expect(result.organization.name).toBe("Acme");
    expect(result.organization.slug).toBe("acme");
    expect(result.tokens.accessToken).toMatch(/^access:/);
  });

  it("throws UnauthorizedError on unknown email", async () => {
    await expect(
      useCase.execute({ email: "ghost@example.com", password: "secret123" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("throws UnauthorizedError on wrong password", async () => {
    await expect(
      useCase.execute({ email: "alice@example.com", password: "wrong" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("does not leak which field was wrong", async () => {
    let unknownEmailMessage = "";
    let wrongPwMessage = "";
    try {
      await useCase.execute({ email: "ghost@example.com", password: "secret123" });
    } catch (err) {
      unknownEmailMessage = (err as Error).message;
    }
    try {
      await useCase.execute({ email: "alice@example.com", password: "wrong" });
    } catch (err) {
      wrongPwMessage = (err as Error).message;
    }
    expect(unknownEmailMessage).toBe(wrongPwMessage);
  });
});
