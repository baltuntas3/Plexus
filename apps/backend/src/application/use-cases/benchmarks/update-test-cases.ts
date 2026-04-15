import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import { ensureBenchmarkAccess } from "./ensure-benchmark-access.js";

export interface UpdateTestCasesCommand {
  benchmarkId: string;
  ownerId: string;
  updates: Array<{ id: string; expectedOutput: string | null }>;
}

// Allows the owner to annotate generated test cases with expected outputs
// while the benchmark is still in "draft" status.
export class UpdateTestCasesUseCase {
  constructor(private readonly benchmarks: IBenchmarkRepository) {}

  async execute(command: UpdateTestCasesCommand): Promise<void> {
    const bm = await ensureBenchmarkAccess(
      this.benchmarks,
      command.benchmarkId,
      command.ownerId,
    );
    if (bm.status !== "draft") {
      throw ValidationError(
        "Test cases can only be edited while the benchmark is in draft status",
      );
    }
    await this.benchmarks.updateTestCases(command.benchmarkId, command.updates);
  }
}
