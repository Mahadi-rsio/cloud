import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const TENANT_STATUSES = [
  "trial",
  "active",
  "suspended",
  "pending_delete",
  "deleted",
] as const;

export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const TENANT_PLANS = ["free", "pro", "enterprise"] as const;
export type TenantPlan = (typeof TENANT_PLANS)[number];

export const STORAGE_PLANS = {
  free: {
    name: "free",
    storageLimitBytes: 512 * 1024 * 1024, // 512 MB
    monthlyReadLimitOps: 100_000,          // 100k read operations
    monthlyWriteLimitOps: 100_000,         // 100k write operations
    bandwidthLimitBytes: 5 * 1024 * 1024 * 1024, // 5 GB
    egressRateLimitMbps: 100,
    maxObjectSizeBytes: 100 * 1024 * 1024, // 100 MB max object
  },
  pro: {
    name: "pro",
    storageLimitBytes: 100 * 1024 * 1024 * 1024, // 100 GB
    monthlyReadLimitOps: 10_000_000,
    monthlyWriteLimitOps: 1_000_000,
    bandwidthLimitBytes: 500 * 1024 * 1024 * 1024,
    egressRateLimitMbps: 1000,
    maxObjectSizeBytes: 500 * 1024 * 1024,
  },
  enterprise: {
    name: "enterprise",
    storageLimitBytes: 1024 * 1024 * 1024 * 1024, // 1 TB
    monthlyReadLimitOps: 100_000_000,
    monthlyWriteLimitOps: 10_000_000,
    bandwidthLimitBytes: 5 * 1024 * 1024 * 1024 * 1024,
    egressRateLimitMbps: 10000,
    maxObjectSizeBytes: 5 * 1024 * 1024 * 1024,
  },
} as const;

export const tenants = pgTable(
  "storage_tenants",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status").notNull().default("trial"),
    plan: text("plan").notNull().default("free"),
    storageLimitBytes: bigint("storage_limit_bytes", { mode: "number" })
      .notNull()
      .default(512 * 1024 * 1024), // 512 MB for free plan
    storageUsedBytes: bigint("storage_used_bytes", { mode: "number" })
      .notNull()
      .default(0),
    fileCount: integer("file_count").notNull().default(0),
    monthlyReadLimitOps: integer("monthly_read_limit_ops")
      .notNull()
      .default(100_000), // 100k read operations for free plan
    monthlyWriteLimitOps: integer("monthly_write_limit_ops")
      .notNull()
      .default(100_000), // 100k write operations for free plan
    bandwidthLimitBytes: bigint("bandwidth_limit_bytes", { mode: "number" })
      .notNull()
      .default(5 * 1024 * 1024 * 1024), // 5 GB
    egressRateLimitMbps: integer("egress_rate_limit_mbps").notNull().default(100),
    trialEndsAt: text("trial_ends_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("storage_tenants_status_idx").on(table.status),
    index("storage_tenants_created_idx").on(table.createdAt),
  ],
);

export const projects = pgTable(
  "storage_projects",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("storage_projects_tenant_idx").on(table.tenantId),
    uniqueIndex("storage_projects_tenant_name_idx").on(table.tenantId, table.name),
  ],
);

/** Legacy custom API key table (kept for schema reference; auth now via Better Auth apikey table) */
export const apiKeys = pgTable(
  "storage_api_keys",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    scopes: text("scopes").notNull().default("storage:read,storage:write"),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
    lastUsedAt: text("last_used_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("storage_api_keys_key_hash_idx").on(table.keyHash),
    index("storage_api_keys_tenant_idx").on(table.tenantId),
    index("storage_api_keys_tenant_revoked_idx").on(table.tenantId, table.revokedAt),
  ],
);

export const usageDaily = pgTable(
  "storage_usage_daily",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id"),
    date: text("date").notNull(), // YYYY-MM-DD
    storageBytesAvg: bigint("storage_bytes_avg", { mode: "number" }).notNull().default(0),
    storageBytesPeak: bigint("storage_bytes_peak", { mode: "number" }).notNull().default(0),
    fileCount: integer("file_count").notNull().default(0),
    egressBytes: bigint("egress_bytes", { mode: "number" }).notNull().default(0),
    ingressBytes: bigint("ingress_bytes", { mode: "number" }).notNull().default(0),
    readOps: integer("read_ops").notNull().default(0), // Class B operations (GET, HEAD)
    writeOps: integer("write_ops").notNull().default(0), // Class A operations (PUT, COPY, DELETE, LIST)
    deleteOps: integer("delete_ops").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("storage_usage_daily_tenant_proj_date_idx").on(
      table.tenantId,
      table.projectId,
      table.date,
    ),
    index("storage_usage_daily_tenant_date_idx").on(table.tenantId, table.date),
  ],
);

export const usageEvents = pgTable(
  "storage_usage_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id"),
    timestamp: text("timestamp").notNull(),
    eventType: text("event_type").notNull(), // read | write | delete | list | copy | egress
    classType: text("class_type").notNull().default("class_b"), // class_a | class_b
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
    ops: integer("ops").notNull().default(1),
  },
  (table) => [
    index("storage_usage_events_tenant_time_idx").on(table.tenantId, table.timestamp),
    index("storage_usage_events_tenant_type_idx").on(table.tenantId, table.eventType),
  ],
);

export const auditLog = pgTable(
  "storage_audit_log",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(), // user | api_key | system
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(), // tenant | project | api_key | object
    resourceId: text("resource_id").notNull(),
    metadata: text("metadata"), // JSON-encoded string
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("storage_audit_log_tenant_time_idx").on(table.tenantId, table.createdAt),
    index("storage_audit_log_resource_idx").on(table.resourceType, table.resourceId),
  ],
);

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

export type UsageDaily = typeof usageDaily.$inferSelect;
export type InsertUsageDaily = typeof usageDaily.$inferInsert;

export type UsageEvent = typeof usageEvents.$inferSelect;
export type InsertUsageEvent = typeof usageEvents.$inferInsert;

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type InsertAuditLogEntry = typeof auditLog.$inferInsert;
