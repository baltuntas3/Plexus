import type { IUserRepository } from "../../../domain/repositories/user-repository.js";
import type { IPasswordHasher } from "../../services/password-hasher.js";
import type { ITokenService } from "../../services/token-service.js";
import { UnauthorizedError } from "../../../domain/errors/domain-error.js";
import { toPublicUser, type PublicUser } from "../../../domain/entities/user.js";
import type { LoginInput } from "../../dto/auth-dto.js";

export interface LoginUserResult {
  user: PublicUser;
  tokens: { accessToken: string; refreshToken: string };
}

export class LoginUserUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly hasher: IPasswordHasher,
    private readonly tokens: ITokenService,
  ) {}

  async execute(input: LoginInput): Promise<LoginUserResult> {
    const user = await this.users.findByEmail(input.email);
    if (!user) {
      throw UnauthorizedError("Invalid credentials");
    }

    const ok = await this.hasher.verify(input.password, user.passwordHash);
    if (!ok) {
      throw UnauthorizedError("Invalid credentials");
    }

    const tokens = this.tokens.issueTokenPair({ sub: user.id, email: user.email });
    return { user: toPublicUser(user), tokens };
  }
}
