import { z } from "zod";
import { TASK_TYPES, VERSION_STATUSES } from "@plexus/shared-types";

// Shared variable shape used by create/update boundaries. Keeps the public
// API consistent with `PromptVariableInput` in shared-types.
export const promptVariableInputSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Variable name must match [a-zA-Z_][a-zA-Z0-9_]*")
    .max(64),
  description: z.string().trim().max(500).nullish(),
  defaultValue: z.string().max(2000).nullish(),
  required: z.boolean().optional().default(false),
});
export type PromptVariableInputDto = z.infer<typeof promptVariableInputSchema>;

export const createPromptInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional().default(""),
  taskType: z.enum(TASK_TYPES),
  initialPrompt: z.string().min(1).max(20_000),
  variables: z.array(promptVariableInputSchema).optional(),
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
  // When omitted, the new version inherits the parent's variables (or empty
  // for fresh roots). When provided, it replaces the variable list — the
  // caller is fully responsible for the new shape.
  variables: z.array(promptVariableInputSchema).optional(),
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
