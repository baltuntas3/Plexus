import { Router } from "express";
import { ModelsController } from "../controllers/models-controller.js";
import { createRequireAuth } from "../middleware/require-auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import type { ITokenService } from "../../../application/services/token-service.js";

export const createModelsRouter = (tokens: ITokenService): Router => {
  const router = Router();
  const controller = new ModelsController();
  const requireAuth = createRequireAuth(tokens);

  router.use(requireAuth);
  router.get("/", asyncHandler(controller.list));

  return router;
};
