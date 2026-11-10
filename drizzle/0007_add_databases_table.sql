CREATE TABLE IF NOT EXISTS "databases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"namespace" text NOT NULL,
	"region" text DEFAULT 'iad' NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"primary_host" text NOT NULL,
	"http_url" text NOT NULL,
	"libsql_url" text NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"default_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "databases_namespace_unique" UNIQUE("namespace"),
	CONSTRAINT "databases_status_check" CHECK ("status" in ('provisioning','ready','failed','deleting','deleted'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "databases" ADD CONSTRAINT "databases_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "databases_user_created_idx" ON "databases" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "databases_user_status_idx" ON "databases" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "databases_namespace_idx" ON "databases" USING btree ("namespace");
