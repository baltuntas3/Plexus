import { LoginUserUseCase } from "../login-user.js";
import { InMemoryUserRepository } from "../../../../__tests__/fakes/in-memory-user-repository.js";
import {
  FakePasswordHasher,
  FakeTokenService,
} from "../../../../__tests__/fakes/fake-services.js";

describe("LoginUserUseCase", () => {
  let users: InMemoryUserRepository;
  let hasher: FakePasswordHasher;
  let tokens: FakeTokenService;
  let useCase: LoginUserUseCase;

  beforeEach(async () => {
    users = new InMemoryUserRepository();
    hasher = new FakePasswordHasher();
    tokens = new FakeTokenService();
    useCase = new LoginUserUseCase(users, hasher, tokens);

    await users.create({
      email: "alice@example.com",
      name: "Alice",
      passwordHash: await hasher.hash("secret123"),
    });
  });

  it("returns user and tokens on valid credentials", async () => {
    const result = await useCase.execute({
      email: "alice@example.com",
      password: "secret123",
    });

    expect(result.user.email).toBe("alice@example.com");
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
