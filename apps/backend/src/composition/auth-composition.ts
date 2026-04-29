import { env } from "../infrastructure/config/env.js";
import { BcryptPasswordHasher } from "../infrastructure/auth/bcrypt-password-hasher.js";
import { JwtTokenService } from "../infrastructure/auth/jwt-token-service.js";
import { MongoUserRepository } from "../infrastructure/persistence/mongoose/mongo-user-repository.js";
import { MongoOrganizationRepository } from "../infrastructure/persistence/mongoose/mongo-organization-repository.js";
import { MongoOrganizationMemberRepository } from "../infrastructure/persistence/mongoose/mongo-organization-member-repository.js";
import { MongoObjectIdGenerator } from "../infrastructure/persistence/mongoose/object-id-generator.js";
import { MongoUnitOfWork } from "../infrastructure/persistence/mongoose/mongo-unit-of-work.js";
import { RegisterUserUseCase } from "../application/use-cases/auth/register-user.js";
import { LoginUserUseCase } from "../application/use-cases/auth/login-user.js";
import { RefreshTokensUseCase } from "../application/use-cases/auth/refresh-tokens.js";
import { GetCurrentUserUseCase } from "../application/use-cases/auth/get-current-user.js";
import type { ITokenService } from "../application/services/token-service.js";
import {
  createRequirePermission,
  type RequirePermission,
} from "../presentation/http/middleware/require-permission.js";

export interface AuthComposition {
  registerUser: RegisterUserUseCase;
  loginUser: LoginUserUseCase;
  refreshTokens: RefreshTokensUseCase;
  getCurrentUser: GetCurrentUserUseCase;
  tokenService: ITokenService;
  // Factory exposed alongside the token service so router builders can
  // declaratively gate each route on a single permission. Defense-in-depth:
  // every call also re-validates the caller's membership against the DB.
  requirePermission: RequirePermission;
}

export const createAuthComposition = (): AuthComposition => {
  const users = new MongoUserRepository();
  const organizations = new MongoOrganizationRepository();
  const memberships = new MongoOrganizationMemberRepository();
  const idGenerator = new MongoObjectIdGenerator();
  const uow = new MongoUnitOfWork();
  const hasher = new BcryptPasswordHasher();
  const tokenService = new JwtTokenService({
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtl: env.JWT_ACCESS_TTL,
    refreshTtl: env.JWT_REFRESH_TTL,
  });

  return {
    registerUser: new RegisterUserUseCase(
      users,
      organizations,
      memberships,
      hasher,
      tokenService,
      idGenerator,
      uow,
    ),
    loginUser: new LoginUserUseCase(
      users,
      memberships,
      organizations,
      hasher,
      tokenService,
    ),
    refreshTokens: new RefreshTokensUseCase(users, memberships, tokenService),
    getCurrentUser: new GetCurrentUserUseCase(users),
    tokenService,
    requirePermission: createRequirePermission(memberships),
  };
};
