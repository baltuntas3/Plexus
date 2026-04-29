import { Router } from "express";
import { BenchmarkController } from "../controllers/benchmark-controller.js";
import { createRequireAuth } from "../middleware/require-auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import type { BenchmarkComposition } from "../../../composition/benchmark-composition.js";
import type { ITokenService } from "../../../application/services/token-service.js";
import type { RequirePermission } from "../middleware/require-permission.js";

export const createBenchmarkRouter = (
  benchmarks: BenchmarkComposition,
  tokens: ITokenService,
  requirePermission: RequirePermission,
): Router => {
  const router = Router();
  const controller = new BenchmarkController(benchmarks);
  const requireAuth = createRequireAuth(tokens);

  router.use(requireAuth);

  router.post(
    "/",
    requirePermission("benchmark:create"),
    asyncHandler(controller.create),
  );
  router.get("/", requirePermission("benchmark:read"), asyncHandler(controller.list));
  router.get("/:id", requirePermission("benchmark:read"), asyncHandler(controller.get));
  router.patch(
    "/:id/test-cases",
    requirePermission("benchmark:edit"),
    asyncHandler(controller.updateTestCases),
  );
  router.post(
    "/:id/start",
    requirePermission("benchmark:edit"),
    asyncHandler(controller.start),
  );
  router.get(
    "/:id/analysis",
    requirePermission("benchmark:read"),
    asyncHandler(controller.analysis),
  );
  router.get(
    "/:id/stream",
    requirePermission("benchmark:read"),
    asyncHandler(controller.stream),
  );

  return router;
};
