import { Schema, model } from "mongoose";

const BENCHMARK_STATUSES = ["draft", "queued", "running", "completed", "failed"] as const;

const benchmarkSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    promptVersionIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "PromptVersion" }],
      required: true,
    },
    solverModels: { type: [String], required: true },
    judgeModel: { type: String, required: true },
    generatorModel: { type: String, required: true },
    testCount: { type: Number, required: true, min: 1, max: 100 },
    testCases: {
      type: [
        {
          id: { type: String, required: true },
          input: { type: String, required: true },
          expectedOutput: { type: String, default: null },
        },
      ],
      default: [],
    },
    concurrency: { type: Number, required: true, min: 1, max: 16 },
    status: {
      type: String,
      enum: BENCHMARK_STATUSES,
      required: true,
      default: "draft",
      index: true,
    },
    progress: {
      completed: { type: Number, required: true, default: 0 },
      total: { type: Number, required: true, default: 0 },
    },
    jobId: { type: String, default: null },
    error: { type: String, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

benchmarkSchema.index({ ownerId: 1, createdAt: -1 });

export const BenchmarkModel = model("Benchmark", benchmarkSchema);
