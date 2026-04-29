import type { RequestHandler } from "express";
import type { OrganizationRole } from "@plexus/shared-types";
import {
  ForbiddenError,
  OrganizationMembershipRequiredError,
  UnauthorizedError,
} from "../../../domain/errors/domain-error.js";
import type { IOrganizationMemberRepository } from "../../../domain/repositories/organization-member-repository.js";
import {
  type Permission,
  roleHasPermission,
} from "../../../application/services/permissions.js";

declare global {
  namespace Express {
    interface Request {
      // Resolved on every authenticated request after `requirePermission`
      // succeeds. Downstream middleware/handlers can read it without
      // hitting the repo again.
      organizationRole?: OrganizationRole;
    }
  }
}

// Defense-in-depth authorization. The JWT carries an `organizationId`
// claim, but a stale token whose user has since been removed from the
// org would otherwise still pass. This middleware reloads the membership
// row on every request — the cost is one indexed lookup, paid in
// exchange for closing the "removed-but-still-active-token" window.
export const createRequirePermission = (
  memberships: IOrganizationMemberRepository,
) => {
  return (permission: Permission): RequestHandler => {
    return async (req, _res, next) => {
      try {
        if (!req.userId || !req.organizationId) {
          throw UnauthorizedError("Authentication required");
        }
        const member = await memberships.findByOrganizationAndUser(
          req.organizationId,
          req.userId,
        );
        if (!member) {
          throw OrganizationMembershipRequiredError();
        }
        if (!roleHasPermission(member.role, permission)) {
          throw ForbiddenError(`Permission denied: ${permission}`);
        }
        req.organizationRole = member.role;
        next();
      } catch (err) {
        next(err);
      }
    };
  };
};

// Convenience type for callers that store the factory as a dependency.
export type RequirePermission = (permission: Permission) => RequestHandler;
