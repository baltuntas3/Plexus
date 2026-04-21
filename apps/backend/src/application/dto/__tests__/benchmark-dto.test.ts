import { createBenchmarkSchema } from "../benchmark-dto.js";

const baseInput = {
  name: "Test",
  promptVersionIds: ["v1"],
  solverModels: ["openai/gpt-oss-20b"],
  testCount: 5,
};

describe("createBenchmarkSchema", () => {
  it("accepts the minimal four-field input", () => {
    const result = createBenchmarkSchema.safeParse(baseInput);
    expect(result.success).toBe(true);
  });

  it("rejects duplicate promptVersionIds", () => {
    const result = createBenchmarkSchema.safeParse({
      ...baseInput,
      promptVersionIds: ["v1", "v1"],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/promptVersionIds/);
  });

  it("rejects duplicate solverModels", () => {
    const result = createBenchmarkSchema.safeParse({
      ...baseInput,
      solverModels: ["openai/gpt-oss-20b", "openai/gpt-oss-20b"],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/solverModels/);
  });

  it("rejects testCount outside 1..50", () => {
    expect(createBenchmarkSchema.safeParse({ ...baseInput, testCount: 0 }).success).toBe(false);
    expect(createBenchmarkSchema.safeParse({ ...baseInput, testCount: 51 }).success).toBe(false);
  });

  it("rejects budgetUsd above the hard $50 cap", () => {
    expect(createBenchmarkSchema.safeParse({ ...baseInput, budgetUsd: 50 }).success).toBe(true);
    expect(createBenchmarkSchema.safeParse({ ...baseInput, budgetUsd: 50.01 }).success).toBe(false);
  });
});
