import { RegisterUserUseCase } from "../register-user.js";
import { DomainError } from "../../../../domain/errors/domain-error.js";
import { InMemoryUserRepository } from "../../../../__tests__/fakes/in-memory-user-repository.js";
import { InMemoryOrganizationRepository } from "../../../../__tests__/fakes/in-memory-organization-repository.js";
import { InMemoryOrganizationMemberRepository } from "../../../../__tests__/fakes/in-memory-organization-member-repository.js";
import { InMemoryIdGenerator } from "../../../../__tests__/fakes/in-memory-id-generator.js";
import { NoOpUnitOfWork } from "../../../../__tests__/fakes/no-op-unit-of-work.js";
import {
  FakePasswordHasher,
  FakeTokenService,
} from "../../../../__tests__/fakes/fake-services.js";

describe("RegisterUserUseCase", () => {
  let users: InMemoryUserRepository;
  let organizations: InMemoryOrganizationRepository;
  let memberships: InMemoryOrganizationMemberRepository;
  let hasher: FakePasswordHasher;
  let tokens: FakeTokenService;
  let useCase: RegisterUserUseCase;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    organizations = new InMemoryOrganizationRepository();
    memberships = new InMemoryOrganizationMemberRepository();
    hasher = new FakePasswordHasher();
    tokens = new FakeTokenService();
    useCase = new RegisterUserUseCase(
      users,
      organizations,
      memberships,
      hasher,
      tokens,
      new InMemoryIdGenerator(),
      new NoOpUnitOfWork(),
    );
  });

  const baseInput = {
    email: "alice@example.com",
    password: "secret123",
    name: "Alice",
    organizationName: "Acme",
  };

  it("creates a user, an owning organization, and issues tokens scoped to that org", async () => {
    const result = await useCase.execute(baseInput);

    expect(result.user.email).toBe("alice@example.com");
    expect(result.user.name).toBe("Alice");
    expect(result.organization.id).toBeDefined();
    expect(result.tokens.accessToken).toMatch(/^access:/);
    expect(result.tokens.refreshToken).toMatch(/^refresh:/);
    expect(tokens.issuedCount).toBe(1);

    const org = await organizations.findById(result.organization.id);
    expect(org?.slug).toBe("acme");
    const member = await memberships.findByOrganizationAndUser(
      result.organization.id,
      result.user.id,
    );
    expect(member?.role).toBe("owner");
  });

  it("hashes the password before persisting", async () => {
    await useCase.execute({ ...baseInput, email: "bob@example.com", name: "Bob" });
    const stored = await users.findByEmail("bob@example.com");
    expect(stored?.passwordHash).toBe("hashed:secret123");
  });

  it("rejects duplicate email with ConflictError", async () => {
    await useCase.execute({ ...baseInput, email: "carol@example.com", name: "Carol" });
    await expect(
      useCase.execute({
        ...baseInput,
        email: "carol@example.com",
        password: "another",
        name: "Carol Two",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("never returns the password hash on the user payload", async () => {
    const result = await useCase.execute({
      ...baseInput,
      email: "dave@example.com",
      name: "Dave",
    });
    expect(result.user).not.toHaveProperty("passwordHash");
  });

  it("throws DomainError on conflict (instanceof check)", async () => {
    await useCase.execute({ ...baseInput, email: "eve@example.com", name: "Eve" });
    await expect(
      useCase.execute({
        ...baseInput,
        email: "eve@example.com",
        password: "x",
        name: "y",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("appends a numeric suffix when the slug is already taken", async () => {
    const first = await useCase.execute(baseInput);
    const second = await useCase.execute({
      ...baseInput,
      email: "alice2@example.com",
      // Same organizationName produces the same base slug; collision
      // resolution should pick "acme-2" so registration never fails on
      // a name a user typed.
    });
    const firstOrg = await organizations.findById(first.organization.id);
    const secondOrg = await organizations.findById(second.organization.id);
    expect(firstOrg?.slug).toBe("acme");
    expect(secondOrg?.slug).toBe("acme-2");
  });
});
