import type { RequestHandler } from "express";
import { UnauthorizedError } from "../../../domain/errors/domain-error.js";
import type { ITokenService } from "../../../application/services/token-service.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
    }
  }
}

export const createRequireAuth = (tokens: ITokenService): RequestHandler => {
  return (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return next(UnauthorizedError("Missing bearer token"));
    }
    const token = header.slice("Bearer ".length).trim();
    try {
      const payload = tokens.verifyAccessToken(token);
      req.userId = payload.sub;
      req.userEmail = payload.email;
      return next();
    } catch {
      return next(UnauthorizedError("Invalid access token"));
    }
  };
};
