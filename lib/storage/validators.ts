import { z } from "zod";
import { TENANT_PLANS, TENANT_STATUSES } from "./schema";
import { validateStorageScopes } from "./auth";
import { validatePath } from "./keys";

export const createTenantSchema = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  name: z
    .string()
    .trim()
    .min(1, "Tenant name is required")
    .max(100, "Tenant name too long")
    .regex(/^[a-zA-Z0-9 _.\-@]+$/, "Tenant name contains invalid characters"),
  plan: z.enum(TENANT_PLANS).optional().default("free"),
  storageLimitBytes: z.number().int().positive().optional(),
  bandwidthLimitBytes: z.number().int().positive().optional(),
  egressRateLimitMbps: z.number().int().positive().optional(),
  trialDays: z.number().int().positive().max(365).optional().default(7),
});

export type CreateTenantInput = z.input<typeof createTenantSchema>;

export const updateTenantSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  status: z.enum(TENANT_STATUSES).optional(),
  plan: z.enum(TENANT_PLANS).optional(),
  storageLimitBytes: z.number().int().positive().optional(),
  monthlyReadLimitOps: z.number().int().positive().optional(),
  monthlyWriteLimitOps: z.number().int().positive().optional(),
  bandwidthLimitBytes: z.number().int().positive().optional(),
  egressRateLimitMbps: z.number().int().positive().optional(),
  trialEndsAt: z.string().datetime().optional().nullable(),
});

export type UpdateTenantInput = z.input<typeof updateTenantSchema>;

export const createProjectSchema = z.object({
  tenantId: z.string().trim().min(1, "Tenant ID is required"),
  name: z
    .string()
    .trim()
    .min(1, "Project name is required")
    .max(100, "Project name too long")
    .regex(
      /^[a-zA-Z0-9_\-\.]+$/,
      "Project name can only contain letters, numbers, dashes, dots, and underscores",
    ),
});

export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const createApiKeySchema = z.object({
  tenantId: z.string().trim().min(1, "Tenant ID is required"),
  projectId: z.string().trim().optional(),
  name: z
    .string()
    .trim()
    .min(1, "Key name is required")
    .max(100, "Key name too long")
    .regex(/^[a-zA-Z0-9 _.\-]+$/, "Key name contains invalid characters"),
  environment: z.enum(["live", "test"]).optional().default("live"),
  scopes: z
    .union([
      z.array(z.string().min(1)).min(1, "At least one scope is required"),
      z.string().min(1, "At least one scope is required"),
    ])
    .optional()
    .default("storage:read,storage:write")
    .refine(
      (v) => validateStorageScopes(v).valid,
      {
        message: "At least one valid storage permission scope is required",
      },
    ),
  expiresInDays: z.number().int().positive().max(365).optional(),
  expiresAt: z
    .string()
    .datetime()
    .optional()
    .nullable()
    .refine(
      (v) => !v || new Date(v).getTime() > Date.now(),
      "Expiration timestamp must be in the future",
    ),
});

export type CreateApiKeyInput = z.input<typeof createApiKeySchema>;

export const presignRequestSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1, "File path is required")
    .refine(
      (v) => validatePath(v).valid,
      { message: "Invalid file path" },
    ),
  method: z.enum(["GET", "PUT"]).optional().default("GET"),
  expiresInSeconds: z.number().int().min(1).max(86400).optional().default(3600),
  contentType: z.string().trim().max(128).optional(),
  maxSizeBytes: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024)
    .optional(),
  singleUse: z.boolean().optional(),
});

export type PresignRequestInput = z.input<typeof presignRequestSchema>;

export const recordUsageEventSchema = z.object({
  tenantId: z.string().trim().min(1),
  projectId: z.string().trim().optional(),
  eventType: z.enum(["read", "write", "delete", "egress"]),
  bytes: z.number().int().nonnegative().optional().default(0),
  ops: z.number().int().positive().optional().default(1),
  timestamp: z.string().datetime().optional(),
});

export type RecordUsageEventInput = z.input<typeof recordUsageEventSchema>;

export const listUsageDailyQuerySchema = z.object({
  tenantId: z.string().trim().min(1),
  projectId: z.string().trim().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD")
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD")
    .optional(),
});

export type ListUsageDailyQuery = z.infer<typeof listUsageDailyQuerySchema>;

export const listAuditLogsQuerySchema = z.object({
  tenantId: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  resourceType: z.string().trim().optional(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
