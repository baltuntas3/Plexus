import { createBenchmarkSchema } from "../benchmark-dto.js";

const baseInput = {
  name: "Test",
  promptVersionIds: ["v1"],
  solverModels: ["gpt-4o-mini"],
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
      solverModels: ["gpt-4o-mini", "gpt-4o-mini"],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/solverModels/);
  });

  it("rejects testCount outside 1..100", () => {
    expect(createBenchmarkSchema.safeParse({ ...baseInput, testCount: 0 }).success).toBe(false);
    expect(createBenchmarkSchema.safeParse({ ...baseInput, testCount: 101 }).success).toBe(false);
  });
});
