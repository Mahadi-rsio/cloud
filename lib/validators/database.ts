import { z } from "zod";

export const createDatabaseSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Database name must be at least 2 characters.")
      .max(48, "Database name cannot exceed 48 characters.")
      .regex(
        /^[a-zA-Z0-9_\-\s]+$/,
        "Database name can only contain letters, numbers, spaces, underscores, and hyphens.",
      ),
    region: z.string().trim().default("iad").optional(),
  })
  .strict();

export type CreateDatabaseInput = z.infer<typeof createDatabaseSchema>;
