import { Router } from "express";
import { PromptController } from "../controllers/prompt-controller.js";
import { createRequireAuth } from "../middleware/require-auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import type { PromptComposition } from "../../../composition/prompt-composition.js";
import type { ITokenService } from "../../../application/services/token-service.js";

export const createPromptRouter = (
  prompts: PromptComposition,
  tokens: ITokenService,
): Router => {
  const router = Router();
  const controller = new PromptController(prompts);
  const requireAuth = createRequireAuth(tokens);

  router.use(requireAuth);

  router.post("/", asyncHandler(controller.create));
  router.get("/", asyncHandler(controller.list));
  router.get("/:id", asyncHandler(controller.get));

  router.post("/:id/versions", asyncHandler(controller.createVersion));
  router.get("/:id/versions", asyncHandler(controller.listVersions));
  router.get("/:id/versions/:version", asyncHandler(controller.getVersion));
  router.post("/:id/versions/:version/promote", asyncHandler(controller.promoteVersion));
  router.patch("/:id/versions/:version", asyncHandler(controller.updateVersionName));
  router.post("/:id/versions/:version/generate-braid", asyncHandler(controller.generateBraid));
  router.patch("/:id/versions/:version/braid", asyncHandler(controller.updateBraid));
  router.post("/:id/versions/:version/braid/chat", asyncHandler(controller.chatBraid));
  router.post("/:id/versions/:version/lint", asyncHandler(controller.lintVersion));

  return router;
};
