import { z } from "zod";

export const generateBraidInputSchema = z.object({
  generatorModel: z.string().min(1),
  forceRegenerate: z.boolean().optional().default(false),
});
export type GenerateBraidInputDto = z.infer<typeof generateBraidInputSchema>;

export const updateBraidInputSchema = z.object({
  mermaidCode: z.string().min(1),
});
export type UpdateBraidInputDto = z.infer<typeof updateBraidInputSchema>;

// Frontend maintains the conversation in memory and sends the full
// prior history with each turn. Hard limits are encoded as constants
// here so the boundary schema and the `BraidChatUseCase`'s defense-in-
// depth check share the same numbers — change one place, both layers
// follow.
export const MAX_BRAID_CHAT_HISTORY_MESSAGES = 50;
// ~30k tokens × 4 chars/token: a coarse ceiling that catches runaway
// payloads before they reach the LLM. Per-array-sum constraints are
// awkward in Zod, so the boundary only checks message count; the
// total-character ceiling is enforced inside the use case.
export const MAX_BRAID_CHAT_TOTAL_CHARACTERS = 30_000 * 4;
const PER_MESSAGE_CHAR_LIMIT = 20_000;

export const braidChatTurnSchema = z.object({
  role: z.enum(["user", "agent"]),
  content: z.string().min(1).max(PER_MESSAGE_CHAR_LIMIT),
});

export const braidChatInputSchema = z.object({
  history: z.array(braidChatTurnSchema).max(MAX_BRAID_CHAT_HISTORY_MESSAGES),
  userMessage: z.string().min(1).max(PER_MESSAGE_CHAR_LIMIT),
  generatorModel: z.string().min(1),
});
export type BraidChatInputDto = z.infer<typeof braidChatInputSchema>;

export const saveBraidFromChatInputSchema = z.object({
  mermaidCode: z.string().min(1),
  generatorModel: z.string().min(1),
});
export type SaveBraidFromChatInputDto = z.infer<typeof saveBraidFromChatInputSchema>;
