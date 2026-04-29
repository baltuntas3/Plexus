import { Router } from "express";
import { PromptController } from "../controllers/prompt-controller.js";
import { createRequireAuth } from "../middleware/require-auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import type { PromptComposition } from "../../../composition/prompt-composition.js";
import type { ITokenService } from "../../../application/services/token-service.js";
import type { RequirePermission } from "../middleware/require-permission.js";

export const createPromptRouter = (
  prompts: PromptComposition,
  tokens: ITokenService,
  requirePermission: RequirePermission,
): Router => {
  const router = Router();
  const controller = new PromptController(prompts);
  const requireAuth = createRequireAuth(tokens);

  router.use(requireAuth);

  // Reads — every active role (viewer+) gets these.
  router.get("/", requirePermission("prompt:read"), asyncHandler(controller.list));
  router.get("/:id", requirePermission("prompt:read"), asyncHandler(controller.get));
  router.get(
    "/:id/versions",
    requirePermission("version:read"),
    asyncHandler(controller.listVersions),
  );
  router.get(
    "/:id/versions/:version",
    requirePermission("version:read"),
    asyncHandler(controller.getVersion),
  );
  router.post(
    "/:id/versions/:version/lint",
    requirePermission("version:read"),
    asyncHandler(controller.lintVersion),
  );

  // Prompt-level writes.
  router.post("/", requirePermission("prompt:create"), asyncHandler(controller.create));

  // Version-level writes.
  router.post(
    "/:id/versions",
    requirePermission("version:create"),
    asyncHandler(controller.createVersion),
  );
  router.patch(
    "/:id/versions/:version",
    requirePermission("version:edit"),
    asyncHandler(controller.updateVersionName),
  );
  router.post(
    "/:id/versions/:version/promote",
    requirePermission("prompt:promote"),
    asyncHandler(controller.promoteVersion),
  );
  router.post(
    "/:id/versions/:version/generate-braid",
    requirePermission("version:edit"),
    asyncHandler(controller.generateBraid),
  );
  router.patch(
    "/:id/versions/:version/braid",
    requirePermission("version:edit"),
    asyncHandler(controller.updateBraid),
  );
  router.post(
    "/:id/versions/:version/braid/chat",
    requirePermission("version:edit"),
    asyncHandler(controller.chatBraid),
  );

  return router;
};
