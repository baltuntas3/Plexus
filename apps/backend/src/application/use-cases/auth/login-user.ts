import type { IUserRepository } from "../../../domain/repositories/user-repository.js";
import type { IOrganizationMemberRepository } from "../../../domain/repositories/organization-member-repository.js";
import type { IPasswordHasher } from "../../services/password-hasher.js";
import type { ITokenService } from "../../services/token-service.js";
import { UnauthorizedError } from "../../../domain/errors/domain-error.js";
import { toPublicUser, type PublicUser } from "../../../domain/entities/user.js";
import type { LoginInput } from "../../dto/auth-dto.js";

export interface LoginUserResult {
  user: PublicUser;
  organizationId: string;
  tokens: { accessToken: string; refreshToken: string };
}

export class LoginUserUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly memberships: IOrganizationMemberRepository,
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

    // Multi-org users will get an explicit org switcher (Faz 1B-C); for
    // now we pick the first membership by `joinedAt` so login still has a
    // single deterministic active scope. A user with no memberships at
    // all is an inconsistent account state — registration always creates
    // one, so this branch only catches catastrophic data loss.
    const memberships = await this.memberships.listByUser(user.id);
    const active = memberships[0];
    if (!active) {
      throw UnauthorizedError("User has no organization membership");
    }

    const tokens = this.tokens.issueTokenPair({
      sub: user.id,
      email: user.email,
      organizationId: active.organizationId,
    });
    return {
      user: toPublicUser(user),
      organizationId: active.organizationId,
      tokens,
    };
  }
}
