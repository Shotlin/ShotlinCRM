CREATE TABLE "document_signatures" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"document_id" text NOT NULL,
	"role" text NOT NULL,
	"signer_name" text NOT NULL,
	"signer_title" text DEFAULT '' NOT NULL,
	"signature_key" text,
	"document_sha256" text NOT NULL,
	"ip_address" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal_documents" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "deal_documents" ADD COLUMN "review_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "signature_key" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "signatory_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "signatory_title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_document_id_deal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."deal_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_signatures_doc_idx" ON "document_signatures" USING btree ("document_id");