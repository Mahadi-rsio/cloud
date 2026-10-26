import { relations, sql } from "drizzle-orm";
import {
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
