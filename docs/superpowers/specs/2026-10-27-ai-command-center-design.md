# Shotlin AI Command Center — UI and Architecture Design

Date: 2026-10-27
Status: Approved and implemented, with media OCR/transcription deferred

## 1. Product outcome

Shotlin should answer four questions immediately:

1. Who needs me now, and why?
2. Which new messages have I not read or answered?
3. Which proposals, payments, follow-ups, and projects are at risk?
4. What is the best context-aware reply, with evidence, ready for my review?

The AI assistant is an operational layer over the existing CRM, not a separate chatbot. It reads workspace-scoped WhatsApp/Meta conversations and CRM history, produces traceable recommendations and drafts, and never sends or changes business records autonomously.

### Success criteria

- Every persisted inbound and outbound message receives a terminal analysis state: analyzed, partially analyzed, or failed with a visible retry state.
- Every recommendation shows the sender, reason, source message or CRM record, age/deadline, and priority.
- High and secondary priority order is reproducible from stored scoring factors.
- Reply drafts use the selected contact's actual conversation and business context.
- No provider key reaches the browser, and no AI output can directly send a message or mutate CRM state.
- The deterministic dashboard remains useful when the AI provider is unavailable.

## 2. Design options considered

### Option A — deterministic operations + structured AI understanding (recommended)

PostgreSQL and code calculate unread state, delays, deadlines, outstanding money, and final priority. The provider performs semantic extraction, summaries, risk explanations, and reply drafts through validated structured outputs.

Advantages: reliable priorities, auditable money/date calculations, lower cost, graceful provider outages, and easier testing. Trade-off: requires explicit analysis schemas and scoring rules.

### Option B — provider ranks the whole CRM

Send CRM context to a model and allow it to assign priorities and reasons.

Advantages: initially simple prompts. Disadvantages: inconsistent ordering, weak auditability, expensive repeated context, context-window limits, and unreliable date/money calculations. Rejected.

### Option C — rules only

Use keywords and deterministic rules without a model.

Advantages: cheap and predictable. Disadvantages: poor multilingual intent detection, commitment extraction, nuanced summaries, and natural replies. Rejected as the complete solution; retained as the fallback when AI is unavailable.

## 3. UI design

### Visual references

- [Desktop AI command center](../../../design/mockups/ai-command-center-desktop.png)
- [Desktop contact intelligence and reply](../../../design/mockups/ai-contact-reply-desktop.png)
- [Mobile AI command center](../../../design/mockups/ai-command-center-mobile.png)

### Navigation and routes

Add **AI assistant** directly below Overview in desktop navigation and as a sparkle icon in compact mobile navigation.

- `/ai` — command center.
- `/ai/contacts/[leadId]` — contact intelligence, evidence, and drafts.
- `/ai/replies` — all pending drafts awaiting review.
- `/settings/ai` — owner-only provider, privacy, budget, and analysis controls.

### Command center

Header: **Your day, prioritized**, analysis freshness, and **Review replies**.

Metrics:

- Needs attention: open high + secondary recommendations, deduplicated per contact/reason.
- Unread messages: persisted unread inbound count.
- Replies waiting: conversations whose latest meaningful inbound has no later successfully sent outbound.
- At risk: original-currency amounts converted using the workspace's existing reporting FX rules; the UI must not sum mixed currencies directly.

Priority queue tabs: All, Replies, Follow-ups, Risks. Each row contains avatar, sender, priority, concise reason, quoted evidence, age/deadline, source, and destination. Clicking opens contact intelligence, not an unrelated generic page.

Today: meetings, committed follow-ups, proposal expiries, and payment due items in chronological order.

Business signals: proposal follow-ups, overdue invoices, and project risks. AI briefing: a short cached narrative derived from the already ranked items; it cannot introduce new facts or priorities.

Priority labels:

- **High** — immediate action, severe deadline/risk, or valuable active buying conversation.
- **Secondary** — important but less time-sensitive follow-up.
- **Normal** — visible in filtered/history views without urgent styling.

### Contact intelligence

Three areas on desktop, stacked on mobile:

1. **Why this matters** — priority, response delay, open commitments, value, proposal/payment/project state, and follow-up.
2. **Conversation intelligence** — relevant messages plus extracted intent, requests, commitments, sentiment, and suggested next step. Every extracted fact links to a source message or CRM record.
3. **Suggested reply** — editable draft, evidence chips, regenerate/copy, and **Edit in inbox**. Display **Draft · not sent** and **Nothing is sent automatically**.

A final send requires the existing authenticated inbox send action and its WhatsApp connectivity checks. Regeneration never overwrites an edited draft without confirmation.

### Responsive and accessibility behavior

At mobile widths, metrics become a compact grid, recommendation cards stack, filters scroll horizontally within their own container, and the reply review action remains easy to reach. Tables become labelled rows rather than causing page overflow. Minimum 44px touch targets, keyboard-operable controls, visible focus, accessible names for icon navigation, and no meaning conveyed by color alone.

## 4. Existing evidence and required gaps

Current sources already include leads/stages/value, conversations/unread counts, messages/media, proposals/items, clients, invoices/items, payments, notes, calendar events, activities, templates, and Meta attribution.

Two gaps must be addressed explicitly:

1. **Message read state:** `unreadCount` exists, but durable per-conversation `lastReadAt` does not. Add it and derive unread consistently.
2. **Project delays:** there is no first-class project/deadline record. AI must not infer an official project delay from vague chat text. Add a minimal `projects` record with client/lead/proposal links, title, status, start/due/completed dates, and timestamps. Chat can suggest a possible risk, but only a real due date produces an overdue calculation.

## 5. Data model additions

All tables are workspace-scoped, indexed by workspace/status or workspace/entity, and cascade or restrict deletion consistently with existing records.

### Conversation fields

- `lastReadAt` — set when the user actually views the conversation.
- `lastInboundAt` and `lastOutboundAt` — maintained transactionally for efficient queue calculations; outbound means successfully sent, not queued.

### `projects`

`id`, `workspaceId`, `clientId`, optional `leadId`, optional `proposalId`, `title`, `status` (`active`, `on_hold`, `completed`, `cancelled`), `startsAt`, `dueAt`, `completedAt`, `createdAt`, `updatedAt`.

### `aiProviderSettings`

One per workspace: `provider`, `model`, encrypted API credential, `enabled`, `autoDraftEnabled`, privacy mode, monthly budget ceiling, timestamps. Secrets use the existing envelope-encryption service and are never returned by an API.

### `aiAnalysisRuns`

Tracks every provider/non-provider analysis attempt: entity type/ID, trigger, input hash, prompt/schema versions, provider/model, state (`queued`, `running`, `succeeded`, `partial`, `failed`), attempt count, token/cost usage, error code, started/completed timestamps. Provider error messages are sanitized.

### `messageAnalyses`

One current version per message: language, summary, intent, sentiment, urgency, requested actions, dates/deadlines, commitments, evidence references, confidence, analysis state, schema/prompt versions, analyzed timestamp. Raw structured output may be retained briefly for debugging only if privacy settings allow; validated output is the operational record.

### `conversationSummaries`

Hierarchical summaries for bounded message ranges: conversation, first/last message IDs, summary, open loops, commitments, evidence references, source message count/hash, versions. These prevent long histories from being silently truncated.

### `contactBriefs`

One current brief per lead/contact: overall summary, business state, open loops, risks, next best action, evidence references, source revision/hash, generated timestamp.

### `recommendations`

Contact/client/lead links, type, title, explanation, deterministic score, priority, machine-readable score factors, evidence references, due time, fingerprint, state (`open`, `snoozed`, `dismissed`, `resolved`), snooze-until, generated/resolved timestamps. A workspace-scoped unique fingerprint prevents duplicate open items for the same reason and source.

### `replyDrafts`

Conversation/lead, triggering message, body, evidence references, generation run, state (`draft`, `edited`, `approved`, `discarded`, `sent`), editor, approved timestamp, sent message ID, created/updated timestamps. Approval and sending are separate auditable actions.

## 6. End-to-end analysis pipeline

### A. Persist and enqueue

1. Existing WhatsApp/Meta ingestion commits the lead/conversation/message first.
2. In the same transaction, create an idempotent analysis run keyed by workspace + message + input hash. Outbound messages are also analyzed for commitments and context.
3. After commit, enqueue a BullMQ `shotlin-ai-analysis` job using the run ID as the job ID. A periodic reconciliation finds committed runs that were never enqueued.
4. CRM mutations enqueue contact-recomputation jobs keyed by contact + source revision. Proposal, invoice, payment, calendar, note, project, and stage changes therefore refresh the same intelligence view.

### B. Normalize and build evidence

1. Load records only by authenticated workspace ID.
2. Normalize message text and preserve the original. Detect language without rewriting it.
3. For media, process supported images/documents/audio/video through configured OCR/transcription/caption capabilities. If unsupported, retain metadata and mark analysis **partial**, never pretend the media was understood.
4. Assemble a versioned evidence packet: latest raw messages, all historical chunk summaries, unresolved commitments, relevant older message analyses, lead/client notes, active proposals, invoices/payments, calendar commitments, project dates, and Meta attribution.
5. Bound provider payloads by using hierarchical summaries and evidence-linked retrieval. Every message is still analyzed once and represented in history; context limits must not create unanalysed gaps.

### C. Structured provider analysis

The provider receives instructions plus untrusted CRM/message data and returns schema-validated JSON only. It has no tools and no access to send/update APIs.

Message output includes intent, sentiment, urgency, explicit requests, dates, commitments, whether a response appears needed, evidence message IDs, and confidence. Contact output summarizes current state, open loops, business risks, and next best action using the message analyses plus authoritative CRM facts.

Reject or quarantine malformed output, invalid evidence IDs, unsupported certainty, and attempts to treat message text as instructions. Record a failed/partial run with a retryable error class.

### D. Deterministic operational facts

Compute in code from persisted timestamps and money fields:

- **Unread:** inbound `sentAt > conversation.lastReadAt`.
- **Awaiting reply:** latest meaningful inbound has no later outbound in `sent`, `delivered`, or `read`; queued drafts do not clear the delay.
- **Reply delay:** current time minus that inbound's `sentAt`, using the workspace timezone for display.
- **New chat:** first inbound conversation with no prior outbound, separately labelled even when high priority.
- **Proposal risk:** sent proposal nearing/past `validUntil` without acceptance/decline.
- **Payment risk:** outstanding invoice balance past `dueAt`, based on actual payments.
- **Project delay:** active project past `dueAt`, or a chat-reported blocker linked to an active project; label the latter as reported risk, not confirmed overdue.
- **Today:** calendar and due items within the workspace's local day.

### E. Score and rank

AI supplies semantic facts; code calculates the final 0–100 score. Initial tunable factors:

- Active project overdue: +40.
- Overdue invoice: +35.
- Explicit blocked/negative business situation with evidence: +15.
- Proposal expiring within 48 hours: +25; expired without resolution: +30.
- Committed follow-up due/overdue: +20.
- Unanswered inbound age: +5 at 30 minutes, +12 at 2 hours, +20 at 8 hours, +25 after 24 hours.
- Explicit urgency or near-term event with confident evidence: +20.
- Buying/scope/payment question: +15.
- Unread new enquiry: +8.
- First-response target breached on a new enquiry: +35 (default target 60 minutes, workspace-configurable).
- Deal value percentile within the workspace: +0 to +10.
- Meeting/production commitment today: +10.

Cap at 100. High = 70+, Secondary = 45–69, Normal = below 45. Overdue projects and overdue invoices have a Secondary minimum. Store every contributing factor. Resolve duplicates by recommendation fingerprint, then sort by score, overdue duration, value, and newest evidence. Snoozed/dismissed items stay out of active totals until reopened or materially changed.

Thresholds are configuration, not model suggestions. A model cannot promote an item without the corresponding evidence-backed factors.

### F. Publish and refresh

Persist analyses, briefs, and changed recommendations transactionally, then publish the existing lightweight realtime invalidation event. The browser refetches authorized AI snapshots; SSE never contains message bodies or provider secrets. Dashboard queries recompute time-sensitive age/deadline facts so a quiet queue cannot leave stale urgency.

### G. Backfill and reconciliation

On first enable, enqueue every existing message in chronological batches, oldest to newest, with per-workspace rate limits. Build chunk summaries as batches complete, then contact briefs and recommendations. A progress indicator shows analyzed/total and partial/failed counts. Reconciliation resumes incomplete work after restart without duplicating successful analyses.

## 7. Reply drafting and human approval

1. For a conversation awaiting a response, generate a draft automatically when `autoDraftEnabled` is true; users can also generate manually for any contact/message.
2. Build a fresh evidence packet and include language, tone, open questions, commitments, relevant proposal/payment/project facts, and the user's optional instruction.
3. The draft must answer in the contact's language, avoid inventing availability/prices/dates/discounts, and mark missing business decisions as questions for the user rather than facts.
4. Validate that referenced records exist in the same workspace. Show the evidence used.
5. The user edits, regenerates, copies, discards, or opens the draft in Inbox. Editing preserves the original generation for audit/evaluation.
6. Sending is a separate explicit action through the existing manual message service. Record approver, final body, sent message ID, and activity event.
7. If a newer inbound arrives while generating, mark the draft stale and require regeneration/review before sending.

There is no autonomous sending mode in this design. Adding one later would require a separate design, approval, policies, and audit controls.

## 8. API and service boundaries

Server services:

- `ai/provider` — provider adapters, structured calls, timeouts, usage, sanitized errors.
- `ai/evidence` — workspace-scoped evidence packet assembly and revision hashes.
- `ai/analyzeMessage` — idempotent per-message analysis and validation.
- `ai/summarizeConversation` — lossless-range chunk summaries and contact briefs.
- `ai/operationalFacts` — deterministic unread, response delay, balances, deadlines, and project risk.
- `ai/rank` — score factors, recommendation upsert/resolution, and ordering.
- `ai/drafts` — generation, staleness, editing, approval, and send handoff.
- `ai/settings` — owner-only encrypted configuration and connection tests.

Authenticated endpoints:

- `GET /api/ai/dashboard`
- `GET /api/ai/contacts/[leadId]`
- `POST /api/ai/recommendations/[id]` for snooze/dismiss/reopen
- `POST /api/ai/replies` to generate
- `PATCH /api/ai/replies/[id]` to edit
- `POST /api/ai/replies/[id]/approve` to approve without sending
- `POST /api/ai/replies/[id]/send` to confirm and use the existing send service
- `GET/PUT /api/ai/settings` owner-only; responses contain configuration metadata, never credentials
- `POST /api/ai/settings/test` owner-only provider connection test

All writes require same-origin validation, workspace authorization, Zod input validation, and activity logging.

## 9. Provider configuration, privacy, and cost controls

Use a small provider-agnostic interface supporting Claude (Anthropic official API), OpenAI, and OpenRouter through their server-side HTTPS APIs. Model/provider names and endpoints are server configuration; no SDK or credential runs in browser code.

- Encrypt credentials with the existing AES-256-GCM envelope and a distinct key purpose where supported.
- Prefer provider terms with no training and minimal retention; disclose the configured provider and data categories in Settings.
- Redact unnecessary phone numbers, email addresses, access tokens, payment identifiers, and media object keys before provider calls. Never send WhatsApp auth state, Meta tokens, passwords, or session data.
- Media remains private; provider transfer occurs only for enabled supported analysis, never through public persistent URLs.
- Treat all message/media content as untrusted data to prevent prompt injection. The model receives no operational tools.
- Apply per-workspace concurrency, requests-per-minute, token/month and cost ceilings, payload limits, 30-second timeouts, bounded exponential retries for transient errors, and a circuit breaker for repeated provider failures.
- Cache by input hash + prompt/schema/model versions. New evidence invalidates dependent briefs/drafts; identical requests do not call the provider again.
- Record token/cost usage per run. Stop optional summarization/drafting at budget limits while deterministic alerts continue.
- Support provider disable and deletion of AI-derived data without deleting original CRM records.

## 10. Failure behavior

- **No provider configured:** show real deterministic priorities, unread/reply delay, Today, and financial/project risks; mark semantic panels as not configured.
- **Provider timeout/outage:** retain last valid analysis with its timestamp, enqueue bounded retry, and label stale insights. Never fabricate an up-to-date state.
- **Malformed/unsafe output:** reject it, retain original messages, and show retryable analysis failure rather than partial invented facts.
- **Unsupported media:** show **Partial — media not analyzed** with metadata and manual review action.
- **Queue restart:** resume idempotent runs from PostgreSQL; do not reanalyze successful input hashes.
- **Concurrent CRM change:** revision/hash mismatch triggers a new brief/draft run and marks older output stale.
- **Send failure:** retain the approved draft and use existing outbound failure handling; never mark it sent before provider confirmation.

## 11. Observability and audit

Track queue depth, oldest queued run, completion/partial/failure counts, provider latency, retry rate, token/cost usage, stale briefs, drafts generated/edited/sent, and recommendation resolution. Logs contain workspace/run/entity IDs and sanitized error classes, not message bodies or credentials.

Record user actions for snooze, dismiss, draft edit, approval, and send. Store prompt/model/schema versions so every insight and draft can be reproduced against its evidence revision.

## 12. Verification and evaluation

### Deterministic tests

- Unread transitions and actual conversation viewing.
- Reply delay across inbound, queued outbound, sent outbound, out-of-order messages, and timezone boundaries.
- Partial/full/overdue payments and original/reporting currency totals.
- Proposal expiry, project overdue/on-hold/completed, follow-up due, and snooze/resolution behavior.
- Score thresholds, factor evidence, tie-breaking, and duplicate fingerprints.

### Pipeline integration tests

- Every historical and new message receives exactly one successful current analysis per input hash.
- Queue failure/restart reconciliation and backfill progress.
- Workspace isolation across evidence, drafts, settings, and APIs.
- CRM mutation invalidation, stale draft detection, media partial states, and realtime refresh.
- Provider timeout, malformed JSON, invalid evidence IDs, rate/budget limits, and redaction.

### AI evaluation set

Maintain anonymized/consented representative cases for English, Hindi, Bengali, and mixed-language messages; new enquiries, scope changes, proposal objections, payment promises, delays, no-reply acknowledgements, prompt-injection text, and long histories. Measure extraction accuracy, evidence correctness, unsupported claims, priority-factor precision, draft usefulness, edit distance, and inappropriate auto-commitments. Provider/model changes must run the same suite before rollout.

### UI and end-to-end tests

Validate desktop/mobile command center, contact evidence, draft review, and settings with keyboard and axe checks. Capture 1440, 1280, 768, and 390px screenshots and check overflow. Browser flows cover new inbound → analysis → ranked alert → draft → edit → explicit send, plus provider-unavailable fallback. Live provider quality and live WhatsApp delivery require the user's credentials and remain separately verified.

## 13. Implementation slices after approval

1. **Operational foundation:** read timestamps, project deadlines, deterministic facts/ranking, AI navigation, dashboard/contact UI, and no-provider fallback.
2. **Provider analysis:** encrypted settings, adapter, runs/queues, message analysis, backfill, hierarchical summaries, contact briefs, and evidence UI.
3. **Human-reviewed replies:** automatic/manual drafts, editing/staleness, review queue, explicit send handoff, and audit.
4. **Media and hardening:** supported OCR/transcription, budgets/privacy controls, evaluation suite, observability, responsive/accessibility/browser verification.

Each slice is deployable without weakening existing CRM or WhatsApp behavior. No slice introduces automatic sending.

## 14. Approval gate

Approve or revise the visual references and this architecture before implementation. Provider selection and credentials can remain pending; the operational foundation and UI do not require them.
