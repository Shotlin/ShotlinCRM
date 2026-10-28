import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
});

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  reportingCurrency: text('reporting_currency').notNull().default('INR'),
  // The company signature or seal stamped on countersigned agreements.
  signatureKey: text('signature_key'),
  signatoryName: text('signatory_name').notNull().default(''),
  signatoryTitle: text('signatory_title').notNull().default(''),
  createdAt: createdAt(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('owner'),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
);

export const leads = pgTable(
  'leads',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    company: text('company').notNull().default(''),
    phone: text('phone').notNull().default(''),
    email: text('email').notNull().default(''),
    city: text('city').notNull().default(''),
    source: text('source').notNull(),
    initialMessage: text('initial_message').notNull(),
    status: text('status').notNull(),
    valueMinor: bigint('value_minor', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull(),
    ownerInitials: text('owner_initials').notNull(),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    clientId: text('client_id'),
    followUpAt: timestamp('follow_up_at', { withTimezone: true }),
    // false = a plain WhatsApp chat; true = a lead worked in the pipeline.
    inPipeline: boolean('in_pipeline').notNull().default(true),
    createdAt: createdAt(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('leads_workspace_stage_idx').on(table.workspaceId, table.status)],
);

export const clients = pgTable(
  'clients',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    company: text('company').notNull().default(''),
    email: text('email').notNull().default(''),
    phone: text('phone').notNull().default(''),
    city: text('city').notNull().default(''),
    notes: text('notes').notNull().default(''),
    createdAt: createdAt(),
  },
  (table) => [index('clients_workspace_idx').on(table.workspaceId)],
);

export const conversations = pgTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    leadId: text('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    remoteJid: text('remote_jid'),
    unreadCount: integer('unread_count').notNull().default(0),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    lastOutboundAt: timestamp('last_outbound_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('conversations_workspace_lead_uidx').on(table.workspaceId, table.leadId),
    uniqueIndex('conversations_workspace_jid_uidx').on(table.workspaceId, table.remoteJid),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    leadId: text('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(),
    kind: text('kind').notNull().default('text'),
    body: text('body').notNull().default(''),
    providerMessageId: text('provider_message_id'),
    clientIdempotencyKey: text('client_idempotency_key'),
    source: text('source').notNull().default('whatsapp'),
    state: text('state').notNull().default('sent'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('messages_workspace_provider_uidx').on(table.workspaceId, table.providerMessageId),
    uniqueIndex('messages_workspace_idempotency_uidx').on(table.workspaceId, table.clientIdempotencyKey),
    index('messages_conversation_sent_idx').on(table.conversationId, table.sentAt),
  ],
);

export const messageMedia = pgTable(
  'message_media',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull(),
    mimeType: text('mime_type').notNull(),
    mediaKind: text('media_kind').notNull(),
    filename: text('filename'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksum: text('checksum').notNull(),
    state: text('state').notNull().default('ready'),
    createdAt: createdAt(),
  },
  (table) => [index('message_media_message_idx').on(table.messageId)],
);

export const proposals = pgTable(
  'proposals',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    clientId: text('client_id').references(() => clients.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    status: text('status').notNull(),
    currency: text('currency').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    notes: text('notes').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('proposals_workspace_number_uidx').on(table.workspaceId, table.number)],
);

export const proposalItems = pgTable(
  'proposal_items',
  {
    id: text('id').primaryKey(),
    proposalId: text('proposal_id').notNull().references(() => proposals.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'number' }).notNull(),
    position: integer('position').notNull(),
  },
  (table) => [index('proposal_items_proposal_idx').on(table.proposalId)],
);

export const invoices = pgTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'restrict' }),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    proposalId: text('proposal_id').references(() => proposals.id, { onDelete: 'set null' }),
    status: text('status').notNull(),
    currency: text('currency').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    notes: text('notes').notNull().default(''),
    // GST invoice fields. All null for plain invoices, so existing invoices are unaffected.
    docType: text('doc_type'),
    series: text('series'),
    fy: text('fy'),
    serial: integer('serial'),
    supplyType: text('supply_type'),
    taxRatePct: integer('tax_rate_pct').notNull().default(18),
    sac: text('sac').notNull().default('998314'),
    paymentTerms: text('payment_terms').notNull().default(''),
    // Billing details are copied onto the invoice so later client edits never change it.
    customer: jsonb('customer').$type<{
      name: string;
      representative?: string;
      address: string;
      cityStatePin: string;
      pan?: string;
      gstin?: string;
      placeOfSupply: string;
      stateCode: string;
    }>(),
    project: jsonb('project').$type<{
      name: string;
      category?: string;
      reference?: string;
      advanceRef?: string;
      advanceNote?: string;
    }>(),
    projectTaxableMinor: bigint('project_taxable_minor', { mode: 'number' }),
    advanceTaxableMinor: bigint('advance_taxable_minor', { mode: 'number' }),
    gstTreatment: text('gst_treatment').notNull().default(''),
    adjustmentNote: text('adjustment_note').notNull().default(''),
    terms: jsonb('terms').$type<string[]>().notNull().default([]),
    // Issued invoices are cancelled, never deleted, so the number sequence stays unbroken.
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    driveFiles: jsonb('drive_files').$type<{
      state?: 'pending' | 'synced' | 'failed';
      pdfId?: string;
      docxId?: string;
      pdfUrl?: string;
      docxUrl?: string;
      destination?: 'pending' | 'quarter';
      folderName?: string;
      syncedAt?: string;
      error?: string | null;
      attempts?: number;
      nextAttemptAt?: string | null;
    }>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('invoices_workspace_number_uidx').on(table.workspaceId, table.number),
    // Plain invoices have a null series, and nulls never collide in a unique index.
    uniqueIndex('invoices_series_serial_uidx').on(table.workspaceId, table.series, table.fy, table.serial),
  ],
);

// Next serial per series and financial year. Allocated with a row lock, never reused.
export const invoiceSeries = pgTable(
  'invoice_series',
  {
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    series: text('series').notNull(),
    fy: text('fy').notNull(),
    nextSerial: integer('next_serial').notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.series, table.fy] })],
);

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: text('id').primaryKey(),
    invoiceId: text('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    detail: text('detail').notNull().default(''),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'number' }).notNull(),
    position: integer('position').notNull(),
  },
  (table) => [index('invoice_items_invoice_idx').on(table.invoiceId)],
);

export const payments = pgTable(
  'payments',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    invoiceId: text('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    method: text('method').notNull(),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
  },
  (table) => [index('payments_workspace_received_idx').on(table.workspaceId, table.receivedAt)],
);

export const leadNotes = pgTable(
  'lead_notes',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    leadId: text('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('lead_notes_lead_idx').on(table.leadId)],
);

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    type: text('type').notNull(),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    clientId: text('client_id').references(() => clients.id, { onDelete: 'set null' }),
    href: text('href'),
    createdAt: createdAt(),
  },
  (table) => [index('calendar_workspace_start_idx').on(table.workspaceId, table.startsAt)],
);

export const activityEvents = pgTable(
  'activity_events',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [index('activity_workspace_created_idx').on(table.workspaceId, table.createdAt)],
);

export const messageTemplates = pgTable(
  'message_templates',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    body: text('body').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('templates_workspace_idx').on(table.workspaceId)],
);

// The R2 bucket a workspace stores its files in. The keys are encrypted and never sent back to the browser.
export const storageConnections = pgTable('storage_connections', {
  workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('r2'),
  accountId: text('account_id').notNull(),
  bucket: text('bucket').notNull(),
  accessKeyCiphertext: text('access_key_ciphertext').notNull(),
  secretKeyCiphertext: text('secret_key_ciphertext').notNull(),
  limitGb: integer('limit_gb').notNull().default(10),
  // migrating: existing files are being copied. connected: new files go to the bucket. error: see lastError.
  state: text('state').notNull().default('migrating'),
  totalFiles: integer('total_files').notNull().default(0),
  copiedFiles: integer('copied_files').notNull().default(0),
  lastError: text('last_error'),
  connectedAt: timestamp('connected_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const whatsappConnections = pgTable(
  'whatsapp_connections',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().unique().references(() => workspaces.id, { onDelete: 'cascade' }),
    phone: text('phone'),
    state: text('state').notNull().default('disconnected'),
    qrCiphertext: text('qr_ciphertext'),
    qrExpiresAt: timestamp('qr_expires_at', { withTimezone: true }),
    generation: integer('generation').notNull().default(0),
    lastError: text('last_error'),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
);

export const whatsappAuthState = pgTable(
  'whatsapp_auth_state',
  {
    connectionId: text('connection_id').notNull().references(() => whatsappConnections.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    keyId: text('key_id').notNull(),
    encryptedValue: text('encrypted_value').notNull(),
    revision: integer('revision').notNull().default(1),
    updatedAt: updatedAt(),
  },
  (table) => [primaryKey({ columns: [table.connectionId, table.category, table.keyId] })],
);

export const outboundJobs = pgTable(
  'outbound_jobs',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
    state: text('state').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('outbound_jobs_message_uidx').on(table.messageId)],
);

export const metaConnections = pgTable(
  'meta_connections',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().unique().references(() => workspaces.id, { onDelete: 'cascade' }),
    pageId: text('page_id').notNull(),
    encryptedAccessToken: text('encrypted_access_token').notNull(),
    verifyTokenHash: text('verify_token_hash').notNull(),
    status: text('status').notNull().default('connected'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
);

export const metaLeadEvents = pgTable(
  'meta_lead_events',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    leadgenId: text('leadgen_id').notNull(),
    eventId: text('event_id').notNull(),
    processingState: text('processing_state').notNull().default('received'),
    lastError: text('last_error'),
    receivedAt: createdAt(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('meta_events_workspace_lead_uidx').on(table.workspaceId, table.leadgenId),
    uniqueIndex('meta_events_workspace_event_uidx').on(table.workspaceId, table.eventId),
  ],
);

export const leadAttributions = pgTable(
  'lead_attributions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    leadId: text('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    pageId: text('page_id'),
    formId: text('form_id'),
    adId: text('ad_id'),
    adName: text('ad_name'),
    adsetId: text('adset_id'),
    adsetName: text('adset_name'),
    campaignId: text('campaign_id'),
    campaignName: text('campaign_name'),
    clickId: text('click_id'),
    sourceUrl: text('source_url'),
    createdAt: createdAt(),
  },
  (table) => [index('attributions_lead_idx').on(table.leadId)],
);

export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    proposalId: text('proposal_id').references(() => proposals.id, { onDelete: 'set null' }),
    // The signed agreement this project was created from.
    agreementId: text('agreement_id'),
    brief: text('brief').notNull().default(''),
    // The timeline: planned blocks of work, shown to the client on the shared page.
    roadmap: jsonb('roadmap').$type<{ id: string; title: string; detail: string; dueOn: string | null; status: 'planned' | 'in_progress' | 'done' }[]>().notNull().default([]),
    title: text('title').notNull(),
    status: text('status').notNull().default('active'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('projects_workspace_due_idx').on(table.workspaceId, table.dueAt),
    index('projects_client_idx').on(table.clientId),
  ],
);

export const aiProviderSettings = pgTable('ai_provider_settings', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().unique().references(() => workspaces.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  encryptedApiKey: text('encrypted_api_key').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  autoDraftEnabled: boolean('auto_draft_enabled').notNull().default(true),
  redactIdentifiers: boolean('redact_identifiers').notNull().default(true),
  firstResponseMinutes: integer('first_response_minutes').notNull().default(60),
  monthlyTokenBudget: integer('monthly_token_budget').notNull().default(1_000_000),
  privacyMode: text('privacy_mode').notNull().default('redacted'),
  lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
  lastTestError: text('last_test_error'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const aiAnalysisRuns = pgTable(
  'ai_analysis_runs',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    trigger: text('trigger').notNull(),
    inputHash: text('input_hash').notNull(),
    promptVersion: text('prompt_version').notNull(),
    schemaVersion: text('schema_version').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    state: text('state').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('ai_runs_entity_hash_uidx').on(
      table.workspaceId,
      table.entityType,
      table.entityId,
      table.inputHash,
    ),
    index('ai_runs_workspace_state_idx').on(table.workspaceId, table.state),
  ],
);

export const messageAnalyses = pgTable(
  'message_analyses',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull().unique().references(() => messages.id, { onDelete: 'cascade' }),
    leadId: text('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    runId: text('run_id').references(() => aiAnalysisRuns.id, { onDelete: 'set null' }),
    language: text('language').notNull(),
    summary: text('summary').notNull(),
    intent: text('intent').notNull(),
    sentiment: text('sentiment').notNull(),
    urgency: text('urgency').notNull(),
    needsReply: boolean('needs_reply').notNull().default(false),
    requestedActions: jsonb('requested_actions').$type<string[]>().notNull().default([]),
    commitments: jsonb('commitments')
      .$type<{ text: string; dueAt: string | null }[]>()
      .notNull()
      .default([]),
    dates: jsonb('dates').$type<{ text: string; date: string | null }[]>().notNull().default([]),
    evidence: jsonb('evidence')
      .$type<{ messageId: string; quote: string }[]>()
      .notNull()
      .default([]),
    confidence: integer('confidence').notNull(),
    state: text('state').notNull().default('succeeded'),
    promptVersion: text('prompt_version').notNull(),
    schemaVersion: text('schema_version').notNull(),
    analyzedAt: timestamp('analyzed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('message_analyses_lead_idx').on(table.workspaceId, table.leadId)],
);

export const conversationSummaries = pgTable(
  'conversation_summaries',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    firstMessageId: text('first_message_id').notNull(),
    lastMessageId: text('last_message_id').notNull(),
    messageCount: integer('message_count').notNull(),
    summary: text('summary').notNull(),
    openLoops: jsonb('open_loops').$type<string[]>().notNull().default([]),
    commitments: jsonb('commitments').$type<string[]>().notNull().default([]),
    evidence: jsonb('evidence')
      .$type<{ messageId: string; quote: string }[]>()
      .notNull()
      .default([]),
    sourceHash: text('source_hash').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('conversation_summaries_range_uidx').on(
      table.workspaceId,
      table.conversationId,
      table.firstMessageId,
      table.lastMessageId,
    ),
  ],
);

export const contactBriefs = pgTable(
  'contact_briefs',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    leadId: text('lead_id').notNull().unique().references(() => leads.id, { onDelete: 'cascade' }),
    runId: text('run_id').references(() => aiAnalysisRuns.id, { onDelete: 'set null' }),
    summary: text('summary').notNull(),
    businessState: text('business_state').notNull(),
    openLoops: jsonb('open_loops').$type<string[]>().notNull().default([]),
    risks: jsonb('risks').$type<string[]>().notNull().default([]),
    nextBestAction: text('next_best_action').notNull(),
    evidence: jsonb('evidence')
      .$type<{ messageId?: string; entityType: string; entityId: string; quote: string }[]>()
      .notNull()
      .default([]),
    confidence: integer('confidence').notNull(),
    sourceHash: text('source_hash').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('contact_briefs_workspace_idx').on(table.workspaceId)],
);

export const recommendations = pgTable(
  'recommendations',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    clientId: text('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    explanation: text('explanation').notNull(),
    priority: text('priority').notNull(),
    score: integer('score').notNull(),
    scoreFactors: jsonb('score_factors')
      .$type<{ code: string; label: string; points: number }[]>()
      .notNull()
      .default([]),
    evidence: jsonb('evidence')
      .$type<{ kind: string; id: string; label: string; quote?: string }[]>()
      .notNull()
      .default([]),
    fingerprint: text('fingerprint').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    state: text('state').notNull().default('open'),
    snoozeUntil: timestamp('snooze_until', { withTimezone: true }),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('recommendations_fingerprint_uidx').on(table.workspaceId, table.fingerprint),
    index('recommendations_queue_idx').on(
      table.workspaceId,
      table.state,
      table.priority,
      table.score,
    ),
  ],
);

export const replyDrafts = pgTable(
  'reply_drafts',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    leadId: text('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    triggeringMessageId: text('triggering_message_id').references(() => messages.id, { onDelete: 'set null' }),
    runId: text('run_id').references(() => aiAnalysisRuns.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    language: text('language').notNull(),
    evidence: jsonb('evidence')
      .$type<{ messageId?: string; entityType: string; entityId: string; quote: string }[]>()
      .notNull()
      .default([]),
    missingInfoQuestions: jsonb('missing_info_questions').$type<string[]>().notNull().default([]),
    state: text('state').notNull().default('draft'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    sentMessageId: text('sent_message_id').references(() => messages.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('reply_drafts_workspace_state_idx').on(table.workspaceId, table.state),
    index('reply_drafts_trigger_idx').on(table.triggeringMessageId),
  ],
);

// Money going out: bills, subscriptions, salaries, ads, loans and one-off purchases.
export const expenses = pgTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    spentAt: timestamp('spent_at', { withTimezone: true }).notNull(),
    title: text('title').notNull(),
    category: text('category').notNull(),
    payeeName: text('payee_name').notNull(),
    payeeType: text('payee_type').notNull().default('vendor'),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    // GST paid inside the amount, when the bill shows it. Counts as input credit if eligible.
    gstMinor: bigint('gst_minor', { mode: 'number' }).notNull().default(0),
    itcEligible: boolean('itc_eligible').notNull().default(false),
    // false = a surprise: not part of the normal monthly spending.
    planned: boolean('planned').notNull().default(true),
    recurring: boolean('recurring').notNull().default(false),
    method: text('method').notNull().default(''),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
  },
  (table) => [index('expenses_workspace_spent_idx').on(table.workspaceId, table.spentAt)],
);

// A proposal or agreement written outside the CRM and uploaded here with its cost and payment milestones.
export const dealDocuments = pgTable(
  'deal_documents',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    clientId: text('client_id').references(() => clients.id, { onDelete: 'set null' }),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    reference: text('reference').notNull().default(''),
    status: text('status').notNull().default('draft'),
    baseAmountMinor: bigint('base_amount_minor', { mode: 'number' }).notNull().default(0),
    gstRatePct: integer('gst_rate_pct').notNull().default(18),
    issuedOn: timestamp('issued_on', { withTimezone: true }),
    signedOn: timestamp('signed_on', { withTimezone: true }),
    // Target delivery length in days, counted from kickoff.
    durationDays: integer('duration_days'),
    brief: text('brief').notNull().default(''),
    // A document written in the CRM: the blocks the PDF is made from. Null for an uploaded PDF.
    content: jsonb('content').$type<{ id: string; type: 'h1' | 'h2' | 'p' | 'bullets' | 'numbered' | 'table' | 'pagebreak'; text: string }[] | null>(),
    // Where the signatures go on the PDF, as fractions of the page so they do not depend on screen size.
    signFields: jsonb('sign_fields').$type<{ id: string; role: 'client' | 'developer'; page: number; x: number; y: number; w: number; h: number }[]>().notNull().default([]),
    // What the client said when they asked for a change.
    reviewNote: text('review_note').notNull().default(''),
    fileKey: text('file_key'),
    fileName: text('file_name'),
    fileSize: integer('file_size'),
    // For an agreement written from a proposal.
    sourceDocumentId: text('source_document_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('deal_documents_workspace_idx').on(table.workspaceId, table.kind)],
);

// The agreed payment schedule. It belongs to the document first and moves onto the project when one is created.
export const projectMilestones = pgTable(
  'project_milestones',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    documentId: text('document_id').references(() => dealDocuments.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    // 'agreed' is part of the signed payment schedule; 'additional' is extra work billed on top of it.
    kind: text('kind').notNull().default('agreed'),
    title: text('title').notNull(),
    trigger: text('trigger').notNull().default(''),
    // Basis points: 3333 means 33.33%.
    shareBp: integer('share_bp').notNull(),
    baseMinor: bigint('base_minor', { mode: 'number' }).notNull(),
    dueOn: timestamp('due_on', { withTimezone: true }),
    status: text('status').notNull().default('planned'),
    invoiceId: text('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [index('project_milestones_project_idx').on(table.projectId), index('project_milestones_document_idx').on(table.documentId)],
);

// A private link a client can open without logging in. Only a hash of the secret is stored.
export const shareLinks = pgTable(
  'share_links',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    targetId: text('target_id').notNull(),
    label: text('label').notNull().default(''),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    viewCount: integer('view_count').notNull().default(0),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('share_links_token_uidx').on(table.tokenHash), index('share_links_target_idx').on(table.workspaceId, table.kind, table.targetId)],
);

// Every time an issued invoice is amended, what it said before is kept here.
export const invoiceRevisions = pgTable(
  'invoice_revisions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    invoiceId: text('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    reason: text('reason').notNull(),
    previousNumber: text('previous_number').notNull(),
    previousGrandMinor: bigint('previous_grand_minor', { mode: 'number' }).notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('invoice_revisions_invoice_idx').on(table.invoiceId, table.revision)],
);

// Who signed a document, when and from where. The signature image itself is kept in R2.
export const documentSignatures = pgTable(
  'document_signatures',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    documentId: text('document_id').notNull().references(() => dealDocuments.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    signerName: text('signer_name').notNull(),
    signerTitle: text('signer_title').notNull().default(''),
    signatureKey: text('signature_key'),
    // The SHA-256 of the PDF the signer was looking at when they signed.
    documentSha256: text('document_sha256').notNull(),
    ipAddress: text('ip_address').notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('document_signatures_doc_idx').on(table.documentId)],
);
