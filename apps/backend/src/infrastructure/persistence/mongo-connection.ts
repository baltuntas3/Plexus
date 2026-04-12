import mongoose from "mongoose";
import { env } from "../config/env.js";
import { logger } from "../logger/logger.js";

export const connectMongo = async (): Promise<void> => {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGO_URI);
  logger.info("MongoDB connected");
};

export const disconnectMongo = async (): Promise<void> => {
  await mongoose.disconnect();
};
