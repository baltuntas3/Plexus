import type { ISODateString } from "./common.js";
import type { OrganizationDto } from "./organization.js";

export interface UserDto {
  id: string;
  email: string;
  name: string;
  createdAt: ISODateString;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  // Display name for the organization the new user owns. Server derives a
  // slug from it and resolves collisions automatically.
  organizationName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: UserDto;
  // The active organization for this session — every authenticated request
  // is implicitly scoped to it. Frontend stores this alongside the token
  // so the org name can be rendered without an extra round trip.
  organization: OrganizationDto;
  tokens: AuthTokens;
}

export interface RefreshRequest {
  refreshToken: string;
}
