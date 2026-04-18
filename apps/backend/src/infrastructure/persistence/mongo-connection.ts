import mongoose from "mongoose";
import { env } from "../config/env.js";
import { logger } from "../logger/logger.js";
import { BenchmarkResultModel } from "./mongoose/benchmark-result-model.js";

export const connectMongo = async (): Promise<void> => {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGO_URI);
  // BenchmarkResult's unique key changed from the legacy
  // (benchmarkId, testCaseId, promptVersionId, mode, solverModel) shape to
  // include runIndex instead of mode. Sync indexes on boot so older
  // deployments do not keep rejecting repeated runs with duplicate-key errors.
  await BenchmarkResultModel.syncIndexes();
  logger.info("MongoDB connected");
};

export const disconnectMongo = async (): Promise<void> => {
  await mongoose.disconnect();
};
