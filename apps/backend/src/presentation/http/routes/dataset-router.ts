import { Router } from "express";
import { DatasetController } from "../controllers/dataset-controller.js";
import { createRequireAuth } from "../middleware/require-auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import type { DatasetComposition } from "../../../composition/dataset-composition.js";
import type { ITokenService } from "../../../application/services/token-service.js";

export const createDatasetRouter = (
  datasets: DatasetComposition,
  tokens: ITokenService,
): Router => {
  const router = Router();
  const controller = new DatasetController(datasets);
  const requireAuth = createRequireAuth(tokens);

  router.use(requireAuth);

  router.post("/", asyncHandler(controller.create));
  router.post("/generate", asyncHandler(controller.generate));
  router.get("/", asyncHandler(controller.list));
  router.get("/:id", asyncHandler(controller.get));
  router.delete("/:id", asyncHandler(controller.remove));
  router.post("/:id/test-cases", asyncHandler(controller.addTestCases));
  router.delete("/:id/test-cases/:testCaseId", asyncHandler(controller.removeTestCase));

  return router;
};
