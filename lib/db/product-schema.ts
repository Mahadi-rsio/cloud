import { relations, sql } from "drizzle-orm";
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./schema";

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    status: text("status").notNull().default("pending"),
    region: text("region").notNull(),
    runtime: jsonb("runtime"),
    requestedResources: jsonb("requested_resources"),
    lastOperationAt: timestamp("last_operation_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("applications_user_status_idx").on(table.userId, table.status),
    index("applications_user_updated_idx").on(table.userId, table.updatedAt),
    check(
      "applications_status_check",
      sql`${table.status} in ('pending','provisioning','running','failed','deleting','deleted')`,
    ),
  ],
);

export const machines = pgTable(
  "machines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    flyMachineId: text("fly_machine_id").unique(),
    status: text("status").notNull().default("provisioning"),
    region: text("region").notNull(),
    instanceNumber: integer("instance_number").notNull().default(0),
    sharedIpv4: text("shared_ipv4"),
    sharedIpv6: text("shared_ipv6"),
    publicUrl: text("public_url"),
    allocatedResources: jsonb("allocated_resources"),
    error: jsonb("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("machines_application_id_active_idx")
      .on(table.applicationId)
      .where(sql`${table.status} <> 'destroyed'`),
    check(
      "machines_status_check",
      sql`${table.status} in ('provisioning','running','stopped','stopping','starting','restarting','redeploying','failed','destroying','destroyed')`,
    ),
  ],
);

export const applicationsRelations = relations(applications, ({ many }) => ({
  machines: many(machines),
}));

export const machinesRelations = relations(machines, ({ one }) => ({
  application: one(applications, {
    fields: [machines.applicationId],
    references: [applications.id],
  }),
}));

export const deployments = pgTable(
  "deployments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    repoUrl: text("repo_url").notNull(),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    branch: text("branch").notNull().default("main"),
    commitSha: text("commit_sha"),
    status: text("status").notNull().default("queued"),
    errorMessage: text("error_message"),
    imageRef: text("image_ref"),
    flyAppId: text("fly_app_id"),
    flyMachineId: text("fly_machine_id"),
    publicUrl: text("public_url"),
    buildNumber: integer("build_number").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    // Discovery metadata (nullable for backward compatibility)
    rootDirectory: text("root_directory"),
    framework: text("framework"),
    language: text("language"),
    runtime: text("runtime"),
    packageManager: text("package_manager"),
    discoveryMetadata: jsonb("discovery_metadata"),
    discoveryVersion: text("discovery_version"),
  },
  (table) => [
    index("deployments_user_created_idx").on(table.userId, table.createdAt),
    check(
      "deployments_status_check",
      sql`${table.status} in ('queued','preparing','building','pushing','deploying','active','failed','cancelled')`,
    ),
  ],
);

export const deploymentLogs = pgTable(
  "deployment_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deploymentId: uuid("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    stream: text("stream").notNull().default("stdout"),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("deployment_logs_deployment_id_idx").on(table.deploymentId, table.id),
  ],
);

export const deploymentsRelations = relations(deployments, ({ one, many }) => ({
  user: one(user, {
    fields: [deployments.userId],
    references: [user.id],
  }),
  logs: many(deploymentLogs),
}));

export const deploymentLogsRelations = relations(deploymentLogs, ({ one }) => ({
  deployment: one(deployments, {
    fields: [deploymentLogs.deploymentId],
    references: [deployments.id],
  }),
}));

export const databases = pgTable(
  "databases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    namespace: text("namespace").notNull().unique(),
    region: text("region").notNull().default("iad"),
    status: text("status").notNull().default("ready"),
    source: text("source").notNull().default("user"),
    primaryHost: text("primary_host").notNull(),
    httpUrl: text("http_url").notNull(),
    libsqlUrl: text("libsql_url").notNull(),
    publicKey: text("public_key").notNull(),
    privateKey: text("private_key").notNull(),
    defaultToken: text("default_token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("databases_user_created_idx").on(table.userId, table.createdAt),
    index("databases_user_status_idx").on(table.userId, table.status),
    uniqueIndex("databases_namespace_idx").on(table.namespace),
    check(
      "databases_status_check",
      sql`${table.status} in ('provisioning','ready','failed','deleting','deleted')`,
    ),
  ],
);

export const databasesRelations = relations(databases, ({ one }) => ({
  user: one(user, {
    fields: [databases.userId],
    references: [user.id],
  }),
}));

export const authProjects = pgTable(
  "auth_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    namespace: text("namespace").notNull().unique(),
    publicKey: text("public_key").notNull(),
    privateKey: text("private_key").notNull(),
    defaultToken: text("default_token").notNull(),
    primaryHost: text("primary_host").notNull(),
    httpUrl: text("http_url").notNull(),
    libsqlUrl: text("libsql_url").notNull(),
    publishableKey: text("publishable_key").notNull().unique(),
    authSecret: text("auth_secret").notNull(),
    linkedDatabaseId: uuid("linked_database_id").references(() => databases.id),
    status: text("status").notNull().default("provisioning"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("auth_projects_user_idx").on(table.userId),
    index("auth_projects_publishable_key_idx").on(table.publishableKey),
    check(
      "auth_projects_status_check",
      sql`${table.status} in ('provisioning','ready','failed','deleting','deleted')`,
    ),
  ],
);

export const authProjectsRelations = relations(authProjects, ({ one }) => ({
  user: one(user, {
    fields: [authProjects.userId],
    references: [user.id],
  }),
  linkedDatabase: one(databases, {
    fields: [authProjects.linkedDatabaseId],
    references: [databases.id],
  }),
}));

