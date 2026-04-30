import type { User } from "../../domain/entities/user.js";

// Public projection of a User: everything except the password hash. The
// hash never crosses an outbound boundary — auth use cases shape User into
// this view before handing the result to controllers/responders. Lives in
// the application layer (alongside other projections) rather than on the
// domain entity so the domain stays free of "what's safe to wire" concerns.
export type PublicUser = Omit<User, "passwordHash">;

export const toPublicUser = (user: User): PublicUser => {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
};
