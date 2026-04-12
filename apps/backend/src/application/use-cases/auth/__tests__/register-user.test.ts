import { RegisterUserUseCase } from "../register-user.js";
import { DomainError } from "../../../../domain/errors/domain-error.js";
import { InMemoryUserRepository } from "../../../../__tests__/fakes/in-memory-user-repository.js";
import {
  FakePasswordHasher,
  FakeTokenService,
} from "../../../../__tests__/fakes/fake-services.js";

describe("RegisterUserUseCase", () => {
  let users: InMemoryUserRepository;
  let hasher: FakePasswordHasher;
  let tokens: FakeTokenService;
  let useCase: RegisterUserUseCase;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    hasher = new FakePasswordHasher();
    tokens = new FakeTokenService();
    useCase = new RegisterUserUseCase(users, hasher, tokens);
  });

  it("creates a user and issues tokens", async () => {
    const result = await useCase.execute({
      email: "alice@example.com",
      password: "secret123",
      name: "Alice",
    });

    expect(result.user.email).toBe("alice@example.com");
    expect(result.user.name).toBe("Alice");
    expect(result.tokens.accessToken).toMatch(/^access:/);
    expect(result.tokens.refreshToken).toMatch(/^refresh:/);
    expect(tokens.issuedCount).toBe(1);
  });

  it("hashes the password before persisting", async () => {
    await useCase.execute({
      email: "bob@example.com",
      password: "secret123",
      name: "Bob",
    });

    const stored = await users.findByEmail("bob@example.com");
    expect(stored?.passwordHash).toBe("hashed:secret123");
  });

  it("rejects duplicate email with ConflictError", async () => {
    await useCase.execute({
      email: "carol@example.com",
      password: "secret123",
      name: "Carol",
    });

    await expect(
      useCase.execute({
        email: "carol@example.com",
        password: "another",
        name: "Carol Two",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("never returns the password hash on the user payload", async () => {
    const result = await useCase.execute({
      email: "dave@example.com",
      password: "secret123",
      name: "Dave",
    });
    expect(result.user).not.toHaveProperty("passwordHash");
  });

  it("throws DomainError on conflict (instanceof check)", async () => {
    await useCase.execute({
      email: "eve@example.com",
      password: "secret123",
      name: "Eve",
    });
    await expect(
      useCase.execute({
        email: "eve@example.com",
        password: "x",
        name: "y",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
