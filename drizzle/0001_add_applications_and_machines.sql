CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"region" text NOT NULL,
	"runtime" jsonb,
	"requested_resources" jsonb,
	"last_operation_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "applications_slug_unique" UNIQUE("slug"),
	CONSTRAINT "applications_status_check" CHECK ("applications"."status" in ('pending','provisioning','running','failed','deleting','deleted'))
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"fly_machine_id" text,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"region" text NOT NULL,
	"instance_number" integer DEFAULT 0 NOT NULL,
	"shared_ipv4" text,
	"shared_ipv6" text,
	"public_url" text,
	"allocated_resources" jsonb,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machines_fly_machine_id_unique" UNIQUE("fly_machine_id"),
	CONSTRAINT "machines_status_check" CHECK ("machines"."status" in ('provisioning','running','stopped','stopping','starting','restarting','redeploying','failed','destroying','destroyed'))
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_user_status_idx" ON "applications" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "applications_user_updated_idx" ON "applications" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "machines_application_id_active_idx" ON "machines" USING btree ("application_id") WHERE "machines"."status" <> 'destroyed';