CREATE TABLE "auth_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"namespace" text NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"default_token" text NOT NULL,
	"primary_host" text NOT NULL,
	"http_url" text NOT NULL,
	"libsql_url" text NOT NULL,
	"publishable_key" text NOT NULL,
	"auth_secret" text NOT NULL,
	"linked_database_id" uuid,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "auth_projects_namespace_unique" UNIQUE("namespace"),
	CONSTRAINT "auth_projects_publishable_key_unique" UNIQUE("publishable_key"),
	CONSTRAINT "auth_projects_status_check" CHECK ("auth_projects"."status" in ('provisioning','ready','failed','deleting','deleted'))
);
--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "source" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_projects" ADD CONSTRAINT "auth_projects_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_projects" ADD CONSTRAINT "auth_projects_linked_database_id_databases_id_fk" FOREIGN KEY ("linked_database_id") REFERENCES "public"."databases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_projects_user_idx" ON "auth_projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_projects_publishable_key_idx" ON "auth_projects" USING btree ("publishable_key");
