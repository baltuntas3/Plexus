import type { ISODateString } from "./common.js";

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
  tokens: AuthTokens;
}

export interface RefreshRequest {
  refreshToken: string;
}
