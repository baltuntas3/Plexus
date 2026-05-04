import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "../../infrastructure/config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createAuthRouter } from "./routes/auth-router.js";
import { createPromptRouter } from "./routes/prompt-router.js";
import { createModelsRouter } from "./routes/models-router.js";
import { createBenchmarkRouter } from "./routes/benchmark-router.js";
import {
  createInvitationRedemptionRouter,
  createOrganizationRouter,
} from "./routes/organization-router.js";
import type { AuthComposition } from "../../composition/auth-composition.js";
import type { PromptComposition } from "../../composition/prompt-composition.js";
import type { BenchmarkComposition } from "../../composition/benchmark-composition.js";
import type { OrganizationComposition } from "../../composition/organization-composition.js";

interface AppDependencies {
  auth: AuthComposition;
  prompts: PromptComposition;
  benchmarks: BenchmarkComposition;
  organizations: OrganizationComposition;
}

export const createApp = (deps: AppDependencies): Express => {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use("/auth", createAuthRouter(deps.auth));
  app.use(
    "/prompts",
    createPromptRouter(
      deps.prompts,
      deps.auth.tokenService,
      deps.auth.requirePermission,
    ),
  );
  app.use(
    "/benchmarks",
    createBenchmarkRouter(
      deps.benchmarks,
      deps.auth.tokenService,
      deps.auth.requirePermission,
    ),
  );
  app.use(
    "/organizations/:orgId",
    createOrganizationRouter(
      deps.organizations,
      deps.auth.tokenService,
      deps.auth.requirePermission,
    ),
  );
  // Flat redemption path — caller is not yet a member of the target org,
  // so no `:orgId` in the URL and no permission gate. Token + email
  // match is the access guard.
  app.use(
    "/invitations",
    createInvitationRedemptionRouter(deps.organizations, deps.auth.tokenService),
  );
  app.use("/models", createModelsRouter(deps.auth.tokenService));

  app.use(errorHandler);

  return app;
};
