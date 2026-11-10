CREATE TABLE "storage_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"scopes" text DEFAULT 'storage:read,storage:write' NOT NULL,
	"expires_at" text,
	"revoked_at" text,
	"last_used_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "storage_api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "storage_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'trial' NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"storage_limit_bytes" bigint DEFAULT 10737418240 NOT NULL,
	"bandwidth_limit_bytes" bigint DEFAULT 53687091200 NOT NULL,
	"egress_rate_limit_mbps" integer DEFAULT 100 NOT NULL,
	"trial_ends_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_usage_daily" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text,
	"date" text NOT NULL,
	"storage_bytes_avg" bigint DEFAULT 0 NOT NULL,
	"egress_bytes" bigint DEFAULT 0 NOT NULL,
	"ingress_bytes" bigint DEFAULT 0 NOT NULL,
	"read_ops" integer DEFAULT 0 NOT NULL,
	"write_ops" integer DEFAULT 0 NOT NULL,
	"delete_ops" integer DEFAULT 0 NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text,
	"timestamp" text NOT NULL,
	"event_type" text NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"ops" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_api_keys" ADD CONSTRAINT "storage_api_keys_tenant_id_storage_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."storage_tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_api_keys" ADD CONSTRAINT "storage_api_keys_project_id_storage_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."storage_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_audit_log" ADD CONSTRAINT "storage_audit_log_tenant_id_storage_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."storage_tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_projects" ADD CONSTRAINT "storage_projects_tenant_id_storage_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."storage_tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_usage_daily" ADD CONSTRAINT "storage_usage_daily_tenant_id_storage_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."storage_tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_usage_events" ADD CONSTRAINT "storage_usage_events_tenant_id_storage_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."storage_tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "storage_api_keys_key_hash_idx" ON "storage_api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "storage_api_keys_tenant_idx" ON "storage_api_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "storage_api_keys_tenant_revoked_idx" ON "storage_api_keys" USING btree ("tenant_id","revoked_at");--> statement-breakpoint
CREATE INDEX "storage_audit_log_tenant_time_idx" ON "storage_audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "storage_audit_log_resource_idx" ON "storage_audit_log" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "storage_projects_tenant_idx" ON "storage_projects" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_projects_tenant_name_idx" ON "storage_projects" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "storage_tenants_status_idx" ON "storage_tenants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "storage_tenants_created_idx" ON "storage_tenants" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_usage_daily_tenant_proj_date_idx" ON "storage_usage_daily" USING btree ("tenant_id","project_id","date");--> statement-breakpoint
CREATE INDEX "storage_usage_daily_tenant_date_idx" ON "storage_usage_daily" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "storage_usage_events_tenant_time_idx" ON "storage_usage_events" USING btree ("tenant_id","timestamp");--> statement-breakpoint
CREATE INDEX "storage_usage_events_tenant_type_idx" ON "storage_usage_events" USING btree ("tenant_id","event_type");