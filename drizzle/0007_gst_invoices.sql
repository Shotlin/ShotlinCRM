CREATE TABLE "invoice_series" (
	"workspace_id" text NOT NULL,
	"series" text NOT NULL,
	"fy" text NOT NULL,
	"next_serial" integer NOT NULL,
	CONSTRAINT "invoice_series_workspace_id_series_fy_pk" PRIMARY KEY("workspace_id","series","fy")
);
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "detail" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "doc_type" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "series" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "fy" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "serial" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "supply_type" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_rate_pct" integer DEFAULT 18 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "sac" text DEFAULT '998314' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_terms" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "customer" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "project" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "project_taxable_minor" bigint;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "advance_taxable_minor" bigint;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "gst_treatment" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "adjustment_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "terms" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "drive_files" jsonb;--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_series_serial_uidx" ON "invoices" USING btree ("workspace_id","series","fy","serial");