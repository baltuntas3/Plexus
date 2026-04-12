import { z } from "zod";

export const generateBraidInputSchema = z.object({
  generatorModel: z.string().min(1),
  forceRegenerate: z.boolean().optional().default(false),
});
export type GenerateBraidInputDto = z.infer<typeof generateBraidInputSchema>;
