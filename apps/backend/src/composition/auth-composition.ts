import { env } from "../infrastructure/config/env.js";
import { BcryptPasswordHasher } from "../infrastructure/auth/bcrypt-password-hasher.js";
import { JwtTokenService } from "../infrastructure/auth/jwt-token-service.js";
import { MongoUserRepository } from "../infrastructure/persistence/mongoose/mongo-user-repository.js";
import { RegisterUserUseCase } from "../application/use-cases/auth/register-user.js";
import { LoginUserUseCase } from "../application/use-cases/auth/login-user.js";
import { RefreshTokensUseCase } from "../application/use-cases/auth/refresh-tokens.js";
import { GetCurrentUserUseCase } from "../application/use-cases/auth/get-current-user.js";
import type { ITokenService } from "../application/services/token-service.js";

export interface AuthComposition {
  registerUser: RegisterUserUseCase;
  loginUser: LoginUserUseCase;
  refreshTokens: RefreshTokensUseCase;
  getCurrentUser: GetCurrentUserUseCase;
  tokenService: ITokenService;
}

export const createAuthComposition = (): AuthComposition => {
  const users = new MongoUserRepository();
  const hasher = new BcryptPasswordHasher();
  const tokenService = new JwtTokenService({
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtl: env.JWT_ACCESS_TTL,
    refreshTtl: env.JWT_REFRESH_TTL,
  });

  return {
    registerUser: new RegisterUserUseCase(users, hasher, tokenService),
    loginUser: new LoginUserUseCase(users, hasher, tokenService),
    refreshTokens: new RefreshTokensUseCase(users, tokenService),
    getCurrentUser: new GetCurrentUserUseCase(users),
    tokenService,
  };
};
