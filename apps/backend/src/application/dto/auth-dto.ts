import { z } from "zod";

export const registerInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
  // Free-form display name for the organization the new user will own.
  // Slug is derived server-side from this name; collisions get a numeric
  // suffix so registration never fails on slug clash.
  organizationName: z.string().trim().min(1).max(120),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const refreshInputSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshInputSchema>;
