CREATE TABLE "ai_analysis_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"trigger" text NOT NULL,
	"input_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_provider_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"auto_draft_enabled" boolean DEFAULT true NOT NULL,
	"redact_identifiers" boolean DEFAULT true NOT NULL,
	"first_response_minutes" integer DEFAULT 60 NOT NULL,
	"monthly_token_budget" integer DEFAULT 1000000 NOT NULL,
	"privacy_mode" text DEFAULT 'redacted' NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_settings_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "contact_briefs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"run_id" text,
	"summary" text NOT NULL,
	"business_state" text NOT NULL,
	"open_loops" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_best_action" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" integer NOT NULL,
	"source_hash" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_briefs_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"first_message_id" text NOT NULL,
	"last_message_id" text NOT NULL,
	"message_count" integer NOT NULL,
	"summary" text NOT NULL,
	"open_loops" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commitments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"message_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"run_id" text,
	"language" text NOT NULL,
	"summary" text NOT NULL,
	"intent" text NOT NULL,
	"sentiment" text NOT NULL,
	"urgency" text NOT NULL,
	"needs_reply" boolean DEFAULT false NOT NULL,
	"requested_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commitments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" integer NOT NULL,
	"state" text DEFAULT 'succeeded' NOT NULL,
	"prompt_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"analyzed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_analyses_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"client_id" text NOT NULL,
	"lead_id" text,
	"proposal_id" text,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone,
	"due_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"lead_id" text,
	"client_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"explanation" text NOT NULL,
	"priority" text NOT NULL,
	"score" integer NOT NULL,
	"score_factors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"due_at" timestamp with time zone,
	"state" text DEFAULT 'open' NOT NULL,
	"snooze_until" timestamp with time zone,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reply_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"conversation_id" text,
	"triggering_message_id" text,
	"run_id" text,
	"body" text NOT NULL,
	"language" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_info_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"sent_message_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "last_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "last_inbound_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "last_outbound_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_analysis_runs" ADD CONSTRAINT "ai_analysis_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_settings" ADD CONSTRAINT "ai_provider_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_briefs" ADD CONSTRAINT "contact_briefs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_briefs" ADD CONSTRAINT "contact_briefs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_briefs" ADD CONSTRAINT "contact_briefs_run_id_ai_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_analysis_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_analyses" ADD CONSTRAINT "message_analyses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_analyses" ADD CONSTRAINT "message_analyses_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_analyses" ADD CONSTRAINT "message_analyses_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_analyses" ADD CONSTRAINT "message_analyses_run_id_ai_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_analysis_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_drafts" ADD CONSTRAINT "reply_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_drafts" ADD CONSTRAINT "reply_drafts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_drafts" ADD CONSTRAINT "reply_drafts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_drafts" ADD CONSTRAINT "reply_drafts_triggering_message_id_messages_id_fk" FOREIGN KEY ("triggering_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_drafts" ADD CONSTRAINT "reply_drafts_run_id_ai_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_analysis_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_drafts" ADD CONSTRAINT "reply_drafts_sent_message_id_messages_id_fk" FOREIGN KEY ("sent_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_runs_entity_hash_uidx" ON "ai_analysis_runs" USING btree ("workspace_id","entity_type","entity_id","input_hash");--> statement-breakpoint
CREATE INDEX "ai_runs_workspace_state_idx" ON "ai_analysis_runs" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE INDEX "contact_briefs_workspace_idx" ON "contact_briefs" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_summaries_range_uidx" ON "conversation_summaries" USING btree ("workspace_id","conversation_id","first_message_id","last_message_id");--> statement-breakpoint
CREATE INDEX "message_analyses_lead_idx" ON "message_analyses" USING btree ("workspace_id","lead_id");--> statement-breakpoint
CREATE INDEX "projects_workspace_due_idx" ON "projects" USING btree ("workspace_id","due_at");--> statement-breakpoint
CREATE INDEX "projects_client_idx" ON "projects" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendations_fingerprint_uidx" ON "recommendations" USING btree ("workspace_id","fingerprint");--> statement-breakpoint
CREATE INDEX "recommendations_queue_idx" ON "recommendations" USING btree ("workspace_id","state","priority","score");--> statement-breakpoint
CREATE INDEX "reply_drafts_workspace_state_idx" ON "reply_drafts" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE INDEX "reply_drafts_trigger_idx" ON "reply_drafts" USING btree ("triggering_message_id");