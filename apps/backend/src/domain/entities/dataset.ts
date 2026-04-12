import type { TaskType } from "@plexus/shared-types";

export interface TestCase {
  id: string;
  input: string;
  expectedOutput: string | null;
  metadata: Record<string, unknown>;
}

export interface Dataset {
  id: string;
  name: string;
  description: string;
  taskType: TaskType;
  ownerId: string;
  testCases: TestCase[];
  createdAt: Date;
  updatedAt: Date;
}
