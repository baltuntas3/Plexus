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

export const chatBraidInputSchema = z.object({
  userMessage: z.string().min(1),
  generatorModel: z.string().min(1),
  currentMermaid: z.string().optional(),
});
export type ChatBraidInputDto = z.infer<typeof chatBraidInputSchema>;
