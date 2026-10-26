import { z } from "zod";

const regionSchema = z
  .string()
  .trim()
  .regex(/^[a-z]{3}$/, "region must be a 3-letter Fly region code.");

export const runtimeSchema = z
  .object({
    image: z.string().trim().min(1).max(500).optional(),
    guest: z
      .object({
        cpu_kind: z.enum(["shared", "performance"]).optional(),
        cpus: z.number().int().min(1).max(16).optional(),
        memory_mb: z.number().int().min(256).max(32768).optional(),
      })
      .strict()
      .optional(),
    env: z.record(z.string(), z.string()).optional(),
    internalPort: z.number().int().min(1).max(65535).optional(),
  })
  .strict();

export const createApplicationSchema = z
  .object({
    name: z.string().trim().min(2, "name must be at least 2 characters.").max(64),
    region: regionSchema.optional(),
    runtime: runtimeSchema.optional(),
  })
  .strict();

export const updateApplicationSchema = z
  .object({
    name: z.string().trim().min(2, "name must be at least 2 characters.").max(64).optional(),
    region: regionSchema.optional(),
    runtime: runtimeSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined || value.region !== undefined || value.runtime !== undefined,
    { message: "At least one field is required." },
  );

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;
export type RuntimeInput = z.infer<typeof runtimeSchema>;
