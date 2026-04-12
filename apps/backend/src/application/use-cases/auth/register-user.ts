import type { IUserRepository } from "../../../domain/repositories/user-repository.js";
import type { IPasswordHasher } from "../../services/password-hasher.js";
import type { ITokenService } from "../../services/token-service.js";
import { ConflictError } from "../../../domain/errors/domain-error.js";
import { toPublicUser, type PublicUser } from "../../../domain/entities/user.js";
import type { RegisterInput } from "../../dto/auth-dto.js";

export interface RegisterUserResult {
  user: PublicUser;
  tokens: { accessToken: string; refreshToken: string };
}

export class RegisterUserUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly hasher: IPasswordHasher,
    private readonly tokens: ITokenService,
  ) {}

  async execute(input: RegisterInput): Promise<RegisterUserResult> {
    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      throw ConflictError("Email already in use");
    }

    const passwordHash = await this.hasher.hash(input.password);
    const user = await this.users.create({
      email: input.email,
      name: input.name,
      passwordHash,
    });

    const tokens = this.tokens.issueTokenPair({ sub: user.id, email: user.email });
    return { user: toPublicUser(user), tokens };
  }
}
