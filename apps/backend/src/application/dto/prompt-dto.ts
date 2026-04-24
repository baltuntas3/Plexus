import { z } from "zod";
import { TASK_TYPES, VERSION_STATUSES } from "@plexus/shared-types";

export const createPromptInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional().default(""),
  taskType: z.enum(TASK_TYPES),
  initialPrompt: z.string().min(1).max(20_000),
});
export type CreatePromptInputDto = z.infer<typeof createPromptInputSchema>;

export const createVersionInputSchema = z.object({
  sourcePrompt: z.string().min(1).max(20_000),
  name: z.string().trim().min(1).max(80).optional(),
  // Optional ancestor label. When present, the new version records
  // `parentVersionId` so classical prompt evolution carries lineage the
  // same way BRAID fork-on-edit does. When absent, the new version is a
  // fresh root.
  fromVersion: z
    .string()
    .regex(/^v\d+$/, "fromVersion must be a version label like v1")
    .optional(),
});
export type CreateVersionInputDto = z.infer<typeof createVersionInputSchema>;

// `null` clears the name; a trimmed non-empty string sets it. Undefined is
// not accepted — the endpoint is explicitly for changing the name.
export const updateVersionInputSchema = z.object({
  name: z.union([z.string().trim().min(1).max(80), z.null()]),
});
export type UpdateVersionInputDto = z.infer<typeof updateVersionInputSchema>;

// Schema just enforces the type is a known status; the "cannot demote to
// draft" rule is a business invariant and lives on the Prompt aggregate.
export const promoteVersionInputSchema = z.object({
  targetStatus: z.enum(VERSION_STATUSES),
});
export type PromoteVersionInputDto = z.infer<typeof promoteVersionInputSchema>;

export const listPromptsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
});
export type ListPromptsQueryDto = z.infer<typeof listPromptsQuerySchema>;

export const listVersionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListVersionsQueryDto = z.infer<typeof listVersionsQuerySchema>;
