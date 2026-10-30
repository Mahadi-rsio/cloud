ALTER TABLE "deployments" ADD COLUMN "root_directory" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "framework" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "runtime" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "package_manager" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "discovery_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "discovery_version" text;