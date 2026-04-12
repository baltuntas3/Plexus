import type { IUserRepository } from "../../../domain/repositories/user-repository.js";
import type { ITokenService, TokenPair } from "../../services/token-service.js";
import { UnauthorizedError } from "../../../domain/errors/domain-error.js";
import type { RefreshInput } from "../../dto/auth-dto.js";

export class RefreshTokensUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly tokens: ITokenService,
  ) {}

  async execute(input: RefreshInput): Promise<TokenPair> {
    let payload;
    try {
      payload = this.tokens.verifyRefreshToken(input.refreshToken);
    } catch {
      throw UnauthorizedError("Invalid refresh token");
    }

    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw UnauthorizedError("User not found");
    }

    return this.tokens.issueTokenPair({ sub: user.id, email: user.email });
  }
}
