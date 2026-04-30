import type { Request } from "express";
import { UnauthorizedError, ValidationError } from "../../../domain/errors/domain-error.js";

// Single typed asserter for the auth fields the `requireAuth` middleware sets
// on every protected route. Controllers consume `req.userId` / `req.userEmail`
// / `req.organizationId` as optional in Express's typing, but they are
// required at this layer; this helper narrows them in one place so handlers
// can destructure non-optional fields without per-handler defensive code.
//
// The middleware already throws if any of these are missing, so this guard
// is defense-in-depth for the "handler accidentally mounted without
// requireAuth" case rather than a primary check.

export interface AuthContext {
  userId: string;
  email: string;
  organizationId: string;
}

export const getAuthContext = (req: Request): AuthContext => {
  if (!req.userId || !req.userEmail || !req.organizationId) {
    throw UnauthorizedError();
  }
  return {
    userId: req.userId,
    email: req.userEmail,
    organizationId: req.organizationId,
  };
};

// Pre-membership variant. Used by routes that run before the caller is a
// member of the target org (e.g. invitation acceptance) and therefore
// cannot go through `requirePermission`. Email is required because the
// access guard at the use-case level matches the invitation's email
// against the authenticated user's email.
export interface AuthOnlyContext {
  userId: string;
  email: string;
}

export const getAuthOnlyContext = (req: Request): AuthOnlyContext => {
  if (!req.userId || !req.userEmail) {
    throw UnauthorizedError();
  }
  return { userId: req.userId, email: req.userEmail };
};

export const getRequiredParam = (req: Request, name: string): string => {
  const value = req.params[name];
  if (!value) {
    throw ValidationError(`Missing path parameter: ${name}`);
  }
  return value;
};
