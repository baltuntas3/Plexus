import type { Request, RequestHandler, Response } from "express";
import {
  loginInputSchema,
  refreshInputSchema,
  registerInputSchema,
} from "../../../application/dto/auth-dto.js";
import { UnauthorizedError } from "../../../domain/errors/domain-error.js";
import type { AuthComposition } from "../../../composition/auth-composition.js";
import type { PublicUser } from "../../../domain/entities/user.js";
import type { AuthResponse, UserDto } from "@plexus/shared-types";

const toUserDto = (user: PublicUser): UserDto => ({
  id: user.id,
  email: user.email,
  name: user.name,
  createdAt: user.createdAt.toISOString(),
});

export class AuthController {
  constructor(private readonly auth: AuthComposition) {}

  register: RequestHandler = async (req: Request, res: Response) => {
    const input = registerInputSchema.parse(req.body);
    const { user, tokens } = await this.auth.registerUser.execute(input);
    const response: AuthResponse = { user: toUserDto(user), tokens };
    res.status(201).json(response);
  };

  login: RequestHandler = async (req: Request, res: Response) => {
    const input = loginInputSchema.parse(req.body);
    const { user, tokens } = await this.auth.loginUser.execute(input);
    const response: AuthResponse = { user: toUserDto(user), tokens };
    res.json(response);
  };

  refresh: RequestHandler = async (req: Request, res: Response) => {
    const input = refreshInputSchema.parse(req.body);
    const tokens = await this.auth.refreshTokens.execute(input);
    res.json({ tokens });
  };

  me: RequestHandler = async (req: Request, res: Response) => {
    if (!req.userId) {
      throw UnauthorizedError();
    }
    const user = await this.auth.getCurrentUser.execute(req.userId);
    res.json({ user: toUserDto(user) });
  };
}
