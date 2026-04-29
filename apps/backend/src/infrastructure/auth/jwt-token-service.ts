import jwt, { type SignOptions } from "jsonwebtoken";
import type {
  AccessTokenPayload,
  ITokenService,
  RefreshTokenPayload,
  TokenPair,
} from "../../application/services/token-service.js";

export interface JwtConfig {
  accessSecret: string;
  refreshSecret: string;
  accessTtl: string;
  refreshTtl: string;
}

export class JwtTokenService implements ITokenService {
  constructor(private readonly config: JwtConfig) {}

  issueTokenPair(payload: AccessTokenPayload): TokenPair {
    const accessOpts: SignOptions = { expiresIn: this.config.accessTtl as SignOptions["expiresIn"] };
    const refreshOpts: SignOptions = { expiresIn: this.config.refreshTtl as SignOptions["expiresIn"] };

    const accessToken = jwt.sign(payload, this.config.accessSecret, accessOpts);
    const refreshToken = jwt.sign({ sub: payload.sub }, this.config.refreshSecret, refreshOpts);

    return { accessToken, refreshToken };
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    const decoded = jwt.verify(token, this.config.accessSecret);
    if (typeof decoded !== "object" || decoded === null) {
      throw new Error("Invalid token payload");
    }
    const { sub, email, organizationId } = decoded as Record<string, unknown>;
    if (
      typeof sub !== "string" ||
      typeof email !== "string" ||
      typeof organizationId !== "string"
    ) {
      throw new Error("Malformed access token");
    }
    return { sub, email, organizationId };
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    const decoded = jwt.verify(token, this.config.refreshSecret);
    if (typeof decoded !== "object" || decoded === null) {
      throw new Error("Invalid token payload");
    }
    const { sub } = decoded as Record<string, unknown>;
    if (typeof sub !== "string") {
      throw new Error("Malformed refresh token");
    }
    return { sub };
  }
}
