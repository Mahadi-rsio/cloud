ALTER TABLE "storage_tenants" ALTER COLUMN "storage_limit_bytes" SET DEFAULT 536870912;--> statement-breakpoint
ALTER TABLE "storage_tenants" ALTER COLUMN "bandwidth_limit_bytes" SET DEFAULT 5368709120;--> statement-breakpoint
ALTER TABLE "storage_tenants" ADD COLUMN "storage_used_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_tenants" ADD COLUMN "file_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_tenants" ADD COLUMN "monthly_read_limit_ops" integer DEFAULT 100000 NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_tenants" ADD COLUMN "monthly_write_limit_ops" integer DEFAULT 100000 NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_usage_daily" ADD COLUMN "storage_bytes_peak" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_usage_daily" ADD COLUMN "file_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_usage_events" ADD COLUMN "class_type" text DEFAULT 'class_b' NOT NULL;