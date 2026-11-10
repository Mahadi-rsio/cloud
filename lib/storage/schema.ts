import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const tenants = sqliteTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status", { enum: TENANT_STATUSES }).notNull().default("trial"),
    plan: text("plan", { enum: TENANT_PLANS }).notNull().default("free"),
    storageLimitBytes: integer("storage_limit_bytes")
      .notNull()
      .default(10 * 1024 * 1024 * 1024), // 10 GB
    bandwidthLimitBytes: integer("bandwidth_limit_bytes")
      .notNull()
      .default(50 * 1024 * 1024 * 1024), // 50 GB
    egressRateLimitMbps: integer("egress_rate_limit_mbps").notNull().default(100),
    trialEndsAt: text("trial_ends_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("tenants_status_idx").on(table.status),
    index("tenants_created_idx").on(table.createdAt),
  ],
);

export const projects = sqliteTable(
  "projects",
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
    index("projects_tenant_idx").on(table.tenantId),
    uniqueIndex("projects_tenant_name_idx").on(table.tenantId, table.name),
  ],
);

export const apiKeys = sqliteTable(
  "api_keys",
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
    uniqueIndex("api_keys_key_hash_idx").on(table.keyHash),
    index("api_keys_tenant_idx").on(table.tenantId),
    index("api_keys_tenant_revoked_idx").on(table.tenantId, table.revokedAt),
  ],
);

export const usageDaily = sqliteTable(
  "usage_daily",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id"),
    date: text("date").notNull(), // YYYY-MM-DD
    storageBytesAvg: integer("storage_bytes_avg").notNull().default(0),
    egressBytes: integer("egress_bytes").notNull().default(0),
    ingressBytes: integer("ingress_bytes").notNull().default(0),
    readOps: integer("read_ops").notNull().default(0),
    writeOps: integer("write_ops").notNull().default(0),
    deleteOps: integer("delete_ops").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("usage_daily_tenant_proj_date_idx").on(
      table.tenantId,
      table.projectId,
      table.date,
    ),
    index("usage_daily_tenant_date_idx").on(table.tenantId, table.date),
  ],
);

export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id"),
    timestamp: text("timestamp").notNull(),
    eventType: text("event_type").notNull(), // read | write | delete | egress
    bytes: integer("bytes").notNull().default(0),
    ops: integer("ops").notNull().default(1),
  },
  (table) => [
    index("usage_events_tenant_time_idx").on(table.tenantId, table.timestamp),
    index("usage_events_tenant_type_idx").on(table.tenantId, table.eventType),
  ],
);

export const auditLog = sqliteTable(
  "audit_log",
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
    index("audit_log_tenant_time_idx").on(table.tenantId, table.createdAt),
    index("audit_log_resource_idx").on(table.resourceType, table.resourceId),
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
