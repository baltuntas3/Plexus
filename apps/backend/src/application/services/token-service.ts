export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

export interface RefreshTokenPayload {
  sub: string;
}

export interface ITokenService {
  issueTokenPair(payload: AccessTokenPayload): TokenPair;
  verifyAccessToken(token: string): AccessTokenPayload;
  verifyRefreshToken(token: string): RefreshTokenPayload;
}
