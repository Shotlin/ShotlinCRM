ALTER TABLE "leads" ADD COLUMN "in_pipeline" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Leads auto-created from WhatsApp chats (plain UUID ids) become chats, not pipeline leads.
UPDATE "leads" SET "in_pipeline" = false
WHERE "source" = 'whatsapp' AND "id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
