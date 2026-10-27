import { z } from "zod";
import { parseGitHubUrl } from "@/lib/build/github";
import { deploymentStatuses } from "@/lib/build/status";

export { deploymentStatuses };

export const deploymentStatusSchema = z.enum(deploymentStatuses);

const repositoryUrl = z
  .string()
  .trim()
  .min(1, "Please enter a GitHub repository URL.")
  .max(2048)
  .refine((value) => parseGitHubUrl(value) !== null, {
    message:
      "Enter a valid GitHub repository URL, e.g. https://github.com/username/repository",
  });

export const createDeploymentSchema = z
  .object({
    url: repositoryUrl,
    branch: z
      .string()
      .trim()
      .min(1)
      .max(250)
      .regex(/^[A-Za-z0-9._\-\/]+$/, "branch contains unsupported characters.")
      .optional(),
  })
  .strict();

export const validateDeploymentSchema = z
  .object({
    url: repositoryUrl,
  })
  .strict();

export type CreateDeploymentInput = z.infer<typeof createDeploymentSchema>;
export type ValidateDeploymentInput = z.infer<typeof validateDeploymentSchema>;

const logStreamSchema = z.enum(["stdout", "stderr", "system"]);

export const internalLogsSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            stream: logStreamSchema.default("stdout"),
            message: z.string().max(20_000),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const internalStatusSchema = z
  .object({
    status: deploymentStatusSchema,
    errorMessage: z.string().max(2_000).optional(),
    imageRef: z.string().max(500).optional(),
  })
  .strict();

export const internalCompleteSchema = z
  .object({
    imageRef: z.string().trim().min(1).max(500),
    internalPort: z.number().int().min(1).max(65535).optional(),
    commitSha: z.string().trim().max(100).optional(),
  })
  .strict();