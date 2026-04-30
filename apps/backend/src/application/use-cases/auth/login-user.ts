import type { Organization } from "../../../domain/entities/organization.js";
import type { IUserRepository } from "../../../domain/repositories/user-repository.js";
import type { IOrganizationRepository } from "../../../domain/repositories/organization-repository.js";
import type { IOrganizationMemberRepository } from "../../../domain/repositories/organization-member-repository.js";
import type { IPasswordHasher } from "../../services/password-hasher.js";
import type { ITokenService } from "../../services/token-service.js";
import { UnauthorizedError } from "../../../domain/errors/domain-error.js";
import { toPublicUser, type PublicUser } from "../../queries/user-projections.js";
import type { LoginInput } from "../../dto/auth-dto.js";

export interface LoginUserResult {
  user: PublicUser;
  organization: Organization;
  tokens: { accessToken: string; refreshToken: string };
}

export class LoginUserUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly memberships: IOrganizationMemberRepository,
    private readonly organizations: IOrganizationRepository,
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

    const organization = await this.organizations.findById(active.organizationId);
    if (!organization) {
      // Membership row points at a missing org — same "inconsistent state"
      // class as the no-memberships branch above. UoW around all writes
      // means this should be unreachable in practice.
      throw UnauthorizedError("Active organization not found");
    }

    const tokens = this.tokens.issueTokenPair({
      sub: user.id,
      email: user.email,
      organizationId: organization.id,
    });
    return {
      user: toPublicUser(user),
      organization,
      tokens,
    };
  }
}
