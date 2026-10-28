CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"spent_at" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"payee_name" text NOT NULL,
	"payee_type" text DEFAULT 'vendor' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"gst_minor" bigint DEFAULT 0 NOT NULL,
	"itc_eligible" boolean DEFAULT false NOT NULL,
	"planned" boolean DEFAULT true NOT NULL,
	"recurring" boolean DEFAULT false NOT NULL,
	"method" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_workspace_spent_idx" ON "expenses" USING btree ("workspace_id","spent_at");