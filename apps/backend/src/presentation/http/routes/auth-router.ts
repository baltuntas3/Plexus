import { Router } from "express";
import { AuthController } from "../controllers/auth-controller.js";
import { createRequireAuth } from "../middleware/require-auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import type { AuthComposition } from "../../../composition/auth-composition.js";

export const createAuthRouter = (auth: AuthComposition): Router => {
  const router = Router();
  const controller = new AuthController(auth);
  const requireAuth = createRequireAuth(auth.tokenService);

  router.post("/register", asyncHandler(controller.register));
  router.post("/login", asyncHandler(controller.login));
  router.post("/refresh", asyncHandler(controller.refresh));
  router.get("/me", requireAuth, asyncHandler(controller.me));

  return router;
};
