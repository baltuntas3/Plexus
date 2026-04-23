import { env } from "./infrastructure/config/env.js";
import { logger } from "./infrastructure/logger/logger.js";
import { connectMongo, disconnectMongo } from "./infrastructure/persistence/mongo-connection.js";
import { createApp } from "./presentation/http/app.js";
import { createAuthComposition } from "./composition/auth-composition.js";
import { createPromptComposition } from "./composition/prompt-composition.js";
import { createAIComposition } from "./composition/ai-composition.js";
import { createBraidComposition } from "./composition/braid-composition.js";
import { createBenchmarkComposition } from "./composition/benchmark-composition.js";
import { InProcessJobQueue } from "./infrastructure/queue/in-process-job-queue.js";

const bootstrap = async (): Promise<void> => {
  await connectMongo();

  const auth = createAuthComposition();
  const ai = createAIComposition();
  const braid = createBraidComposition(ai.factory);
  const prompts = createPromptComposition(braid.generator, ai.factory, braid.linter);
  const queue = new InProcessJobQueue({
    concurrency: 2,
    onError: (jobId, jobName, err) => {
      logger.error({ jobId, jobName, err }, "job failed");
    },
  });
  const benchmarks = createBenchmarkComposition(ai.factory, queue, prompts.promptQueryService);
  const app = createApp({ auth, prompts, benchmarks });

  const server = app.listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down`);
    server.close();
    await disconnectMongo();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

bootstrap().catch((err) => {
  logger.error({ err }, "Bootstrap failed");
  process.exit(1);
});
