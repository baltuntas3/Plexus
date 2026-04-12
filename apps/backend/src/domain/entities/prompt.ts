import type { TaskType } from "@plexus/shared-types";

export interface Prompt {
  id: string;
  name: string;
  description: string;
  taskType: TaskType;
  ownerId: string;
  productionVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}
