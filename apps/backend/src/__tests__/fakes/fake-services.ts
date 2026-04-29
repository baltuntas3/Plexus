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
    // Roundtrip from the most recent payload so tests that issue with a
    // specific organizationId see it back on verify. Falls back to a
    // deterministic dummy for callers that fabricate a token without ever
    // issuing one.
    const sub = token.slice("access:".length);
    const last = [...this.issued].reverse().find((p) => p.sub === sub);
    if (last) return { ...last };
    return { sub, email: "test@example.com", organizationId: "org-test" };
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    if (!token.startsWith("refresh:")) throw new Error("invalid token");
    return { sub: token.slice("refresh:".length) };
  }

  get issuedCount(): number {
    return this.issued.length;
  }
}
