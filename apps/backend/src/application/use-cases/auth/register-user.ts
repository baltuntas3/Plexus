import {
  Organization,
  slugifyOrganizationName,
} from "../../../domain/entities/organization.js";
import { OrganizationMember } from "../../../domain/entities/organization-member.js";
import type { IOrganizationRepository } from "../../../domain/repositories/organization-repository.js";
import type { IOrganizationMemberRepository } from "../../../domain/repositories/organization-member-repository.js";
import type { IUserRepository } from "../../../domain/repositories/user-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { IUnitOfWork } from "../../../domain/services/unit-of-work.js";
import type { IPasswordHasher } from "../../services/password-hasher.js";
import type { ITokenService } from "../../services/token-service.js";
import { ConflictError } from "../../../domain/errors/domain-error.js";
import { toPublicUser, type PublicUser } from "../../queries/user-projections.js";
import type { RegisterInput } from "../../dto/auth-dto.js";

export interface RegisterUserResult {
  user: PublicUser;
  organization: Organization;
  tokens: { accessToken: string; refreshToken: string };
}

// Registration is "user + organization + ownership" as a single atomic
// operation: the platform's tenant unit is the Organization and a user
// without one would be a stranded account. The three writes (user row,
// org row, member row) live inside a UoW so any failure rolls back the
// whole sign-up — no orphan orgs, no users without their founding org.
export class RegisterUserUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly organizations: IOrganizationRepository,
    private readonly memberships: IOrganizationMemberRepository,
    private readonly hasher: IPasswordHasher,
    private readonly tokens: ITokenService,
    private readonly idGenerator: IIdGenerator,
    private readonly uow: IUnitOfWork,
  ) {}

  async execute(input: RegisterInput): Promise<RegisterUserResult> {
    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      throw ConflictError("Email already in use");
    }

    const passwordHash = await this.hasher.hash(input.password);
    const baseSlug = slugifyOrganizationName(input.organizationName);
    const slug = await this.resolveAvailableSlug(baseSlug);

    const result = await this.uow.run(async () => {
      const user = await this.users.create({
        email: input.email,
        name: input.name,
        passwordHash,
      });

      const organization = Organization.create({
        organizationId: this.idGenerator.newId(),
        name: input.organizationName,
        slug,
        ownerId: user.id,
      });
      await this.organizations.save(organization);

      const member = OrganizationMember.create({
        id: this.idGenerator.newId(),
        organizationId: organization.id,
        userId: user.id,
        role: "owner",
        invitedBy: null,
      });
      await this.memberships.save(member);

      return { user, organization };
    });

    const tokens = this.tokens.issueTokenPair({
      sub: result.user.id,
      email: result.user.email,
      organizationId: result.organization.id,
    });
    return {
      user: toPublicUser(result.user),
      organization: result.organization,
      tokens,
    };
  }

  // Slug collision resolution. We try the base slug, then `<base>-2`,
  // `<base>-3`, ... up to a small ceiling. The unique index is the final
  // line of defense, but a happy-path API caller should not see a 409
  // for a name they typed; the suffix keeps registration idempotent at
  // the user level.
  private async resolveAvailableSlug(base: string): Promise<string> {
    const taken = await this.organizations.findBySlug(base);
    if (!taken) return base;
    for (let i = 2; i <= 99; i += 1) {
      const candidate = `${base}-${i}`;
      const existing = await this.organizations.findBySlug(candidate);
      if (!existing) return candidate;
    }
    // Extremely unlikely fallback: append a short random suffix.
    return `${base}-${Math.floor(Math.random() * 9000) + 1000}`;
  }
}
