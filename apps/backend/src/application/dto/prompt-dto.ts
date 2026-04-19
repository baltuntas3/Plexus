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
  classicalPrompt: z.string().min(1).max(20_000),
  name: z.string().trim().min(1).max(80).optional(),
});
export type CreateVersionInputDto = z.infer<typeof createVersionInputSchema>;

// `null` clears the name; a trimmed non-empty string sets it. Undefined is
// not accepted — the endpoint is explicitly for changing the name.
export const updateVersionInputSchema = z.object({
  name: z.union([z.string().trim().min(1).max(80), z.null()]),
});
export type UpdateVersionInputDto = z.infer<typeof updateVersionInputSchema>;

export const promoteVersionInputSchema = z.object({
  targetStatus: z.enum(VERSION_STATUSES).refine((s) => s !== "draft", {
    message: "targetStatus cannot be 'draft'",
  }),
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
