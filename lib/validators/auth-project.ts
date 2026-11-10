import { z } from "zod";

export const createAuthProjectSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Project name must be at least 2 characters.")
      .max(64, "Project name cannot exceed 64 characters.")
      .regex(
        /^[a-zA-Z0-9_\-\s]+$/,
        "Project name can only contain letters, numbers, spaces, underscores, and hyphens.",
      ),
  })
  .strict();

export type CreateAuthProjectInput = z.infer<typeof createAuthProjectSchema>;
