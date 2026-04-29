export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  // Active organization scope for this session. Authorization middleware
  // reads it as `req.organizationId` so every downstream use case sees a
  // tenant boundary already resolved. Multi-org users get a fresh token
  // (re-login or switch-org endpoint) to change scope.
  organizationId: string;
}

export interface RefreshTokenPayload {
  sub: string;
}

export interface ITokenService {
  issueTokenPair(payload: AccessTokenPayload): TokenPair;
  verifyAccessToken(token: string): AccessTokenPayload;
  verifyRefreshToken(token: string): RefreshTokenPayload;
}
