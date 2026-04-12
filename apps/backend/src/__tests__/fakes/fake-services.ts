import type { IPasswordHasher } from "../../application/services/password-hasher.js";
import type {
  AccessTokenPayload,
  ITokenService,
  RefreshTokenPayload,
  TokenPair,
} from "../../application/services/token-service.js";

export class FakePasswordHasher implements IPasswordHasher {
  async hash(plain: string): Promise<string> {
    return `hashed:${plain}`;
  }
  async verify(plain: string, hash: string): Promise<boolean> {
    return hash === `hashed:${plain}`;
  }
}

export class FakeTokenService implements ITokenService {
  private readonly issued: AccessTokenPayload[] = [];

  issueTokenPair(payload: AccessTokenPayload): TokenPair {
    this.issued.push(payload);
    return {
      accessToken: `access:${payload.sub}`,
      refreshToken: `refresh:${payload.sub}`,
    };
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    if (!token.startsWith("access:")) throw new Error("invalid token");
    return { sub: token.slice("access:".length), email: "test@example.com" };
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    if (!token.startsWith("refresh:")) throw new Error("invalid token");
    return { sub: token.slice("refresh:".length) };
  }

  get issuedCount(): number {
    return this.issued.length;
  }
}
