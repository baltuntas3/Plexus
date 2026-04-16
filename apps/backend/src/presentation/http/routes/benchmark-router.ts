import { Router } from "express";
import { BenchmarkController } from "../controllers/benchmark-controller.js";
import { createRequireAuth } from "../middleware/require-auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import type { BenchmarkComposition } from "../../../composition/benchmark-composition.js";
import type { ITokenService } from "../../../application/services/token-service.js";

export const createBenchmarkRouter = (
  benchmarks: BenchmarkComposition,
  tokens: ITokenService,
): Router => {
  const router = Router();
  const controller = new BenchmarkController(benchmarks);
  const requireAuth = createRequireAuth(tokens);

  router.use(requireAuth);

  router.post("/", asyncHandler(controller.create));
  router.get("/", asyncHandler(controller.list));
  router.get("/:id", asyncHandler(controller.get));
  router.patch("/:id/test-cases", asyncHandler(controller.updateTestCases));
  router.post("/:id/start", asyncHandler(controller.start));
  router.get("/:id/analysis", asyncHandler(controller.analysis));
  router.get("/:id/judge-analysis", asyncHandler(controller.judgeAnalysis));
  router.get("/:id/stream", asyncHandler(controller.stream));

  return router;
};
