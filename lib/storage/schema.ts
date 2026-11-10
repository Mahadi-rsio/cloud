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

export const tenants = pgTable(
  "storage_tenants",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status").notNull().default("trial"),
    plan: text("plan").notNull().default("free"),
    storageLimitBytes: bigint("storage_limit_bytes", { mode: "number" })
      .notNull()
      .default(10 * 1024 * 1024 * 1024), // 10 GB
    bandwidthLimitBytes: bigint("bandwidth_limit_bytes", { mode: "number" })
      .notNull()
      .default(50 * 1024 * 1024 * 1024), // 50 GB
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
    egressBytes: bigint("egress_bytes", { mode: "number" }).notNull().default(0),
    ingressBytes: bigint("ingress_bytes", { mode: "number" }).notNull().default(0),
    readOps: integer("read_ops").notNull().default(0),
    writeOps: integer("write_ops").notNull().default(0),
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
    eventType: text("event_type").notNull(), // read | write | delete | egress
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
