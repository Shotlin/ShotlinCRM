CREATE TABLE "storage_connections" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'r2' NOT NULL,
	"account_id" text NOT NULL,
	"bucket" text NOT NULL,
	"access_key_ciphertext" text NOT NULL,
	"secret_key_ciphertext" text NOT NULL,
	"limit_gb" integer DEFAULT 10 NOT NULL,
	"state" text DEFAULT 'migrating' NOT NULL,
	"total_files" integer DEFAULT 0 NOT NULL,
	"copied_files" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_connections" ADD CONSTRAINT "storage_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;