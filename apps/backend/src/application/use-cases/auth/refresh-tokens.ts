import type { IUserRepository } from "../../../domain/repositories/user-repository.js";
import type { IOrganizationMemberRepository } from "../../../domain/repositories/organization-member-repository.js";
import type { ITokenService, TokenPair } from "../../services/token-service.js";
import { UnauthorizedError } from "../../../domain/errors/domain-error.js";
import type { RefreshInput } from "../../dto/auth-dto.js";

export class RefreshTokensUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly memberships: IOrganizationMemberRepository,
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

    // Re-resolve the active membership. The previous access token's org
    // claim cannot be trusted — the user might have been removed from
    // that org since. Picking the first surviving membership preserves
    // deterministic behavior; multi-org switchers issue their own token.
    const memberships = await this.memberships.listByUser(user.id);
    const active = memberships[0];
    if (!active) {
      throw UnauthorizedError("User has no organization membership");
    }

    return this.tokens.issueTokenPair({
      sub: user.id,
      email: user.email,
      organizationId: active.organizationId,
    });
  }
}
