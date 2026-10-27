# Shotlin CRM

A private CRM for WhatsApp and Meta enquiries: pipeline, conversations, clients, proposals, invoices, payments, finance, calendar, and an evidence-linked AI assistant.

## Architecture

- **Next.js App Router** serves the CRM, authenticated JSON APIs, Meta webhooks, private media, and SSE updates.
- **PostgreSQL + Drizzle** is the system of record. Every query is workspace-scoped.
- **Auth.js** protects the application with a JWT session cookie; owner passwords use Argon2id.
- **Baileys worker** is a separate long-running Node process. It owns one linked-device socket, consumes BullMQ outbound jobs, ingests incoming messages/media, and persists encrypted session keys.
- **Redis + BullMQ** handles message retries, Meta lead processing, AI analysis, control messages, and realtime invalidation.
- **S3-compatible storage** keeps media private. Local development uses `.local/media`; production uses MinIO/S3.
- **Meta Lead Ads webhooks** are signature-verified and create deduplicated Meta leads with campaign/ad attribution.
- **AI analysis** uses deterministic CRM facts for priority and an optional provider for message understanding and reply drafts. The provider key is encrypted in PostgreSQL and never sent to the browser.

The full architecture and implementation record are in `/Users/sayan/.qoder/plans/shotlin-nextjs-full-stack.md`.

## Local development

Requirements: Node 24, PostgreSQL 16+, and Redis 7+.

```bash
npm install
cp .env.example .env.local
# Fill DATABASE_URL, REDIS_URL, AUTH_SECRET, WHATSAPP_AUTH_MASTER_KEY, OWNER_*
npm run db:setup
npm run worker   # terminal 1
npm run dev      # terminal 2
```

The app runs at `http://localhost:3000`. Sign in with the owner email and password from `.env.local`. `npm run db:setup` seeds the demo CRM for the owner. Do not use demo seeding in production.

### WhatsApp linked device

Open **Settings → Integrations → Link WhatsApp**, then scan the QR code from WhatsApp on the phone under **Settings → Linked devices → Link a device**.

This uses Baileys, not the official WhatsApp Business API. It is an unofficial linked-device connection and can require reauthentication or break when WhatsApp changes its Web protocol. Keep message volume human and do not use this application for unsolicited bulk outreach. Incoming messages sync; outgoing messages only send when a user presses Send.

Encrypted auth keys survive worker restarts. A second worker cannot own the same connection. If the phone unlinks the device, the next link requires a new QR scan.

### Meta Lead Ads

1. Create a Meta app with a Page access token and your Page.
2. Add `META_APP_SECRET` to the server environment.
3. Open **Settings → Integrations → Meta lead ads** and enter the Page ID, Page access token, and a private webhook verify token (12+ characters).
4. In Meta App Dashboard → Webhooks, subscribe the Page to the `leadgen` field with URL `https://your-domain/api/webhooks/meta` and the same verify token.
5. Submit a test lead. It arrives as a **Meta** lead with the original form enquiry and available campaign/ad attribution.

### AI assistant

The AI assistant is optional. Open **Settings → AI** and choose Claude (Anthropic official API), OpenAI, or OpenRouter. Paste an API key, choose a model, enable analysis, and save. The provider is tested separately through **Test connection**.

- The command center calculates unread messages, first-response delays, overdue invoices, proposal expiries, project deadlines, follow-ups, and today's work directly from PostgreSQL. These priorities are available without a provider.
- After a provider is configured, new messages are queued through BullMQ for semantic analysis. Use **Analyze all messages** to backfill older history; this consumes provider tokens and can incur cost.
- Reply drafts use the conversation, proposal, payment, project, and follow-up evidence. They are never sent automatically. Review a draft, edit it in the Inbox, and press Send yourself.
- AI priority is deterministic. The provider can identify intent, urgency, and commitments, but only validated factors contribute to the final 0–100 score. High is 70+, Secondary is 45–69, and overdue invoices/projects cannot fall below Secondary.
- Phone numbers and email addresses are redacted before provider calls when **Redact identifiers** is enabled. WhatsApp auth keys, Meta access tokens, passwords, and media object keys are never sent.
- Media without a text caption is marked **partial** and must be reviewed manually. This release does not perform OCR or transcription.
- AI credentials use AES-256-GCM. Set a stable `AI_CREDENTIAL_MASTER_KEY` in production; if omitted, it falls back to `WHATSAPP_AUTH_MASTER_KEY`. Changing the key that protected stored credentials requires re-entering the provider API key.

The AI worker runs inside the existing worker process. It must be running to analyze messages and generate automatic drafts. Existing-message backfill and reply generation require a configured provider; no live provider call is made during automated tests.

## Production

```bash
cp .env.docker.example .env
# Set every value; generate secrets with: openssl rand -base64 32
docker compose up -d --build
docker compose run --rm web npm run auth:create-owner -- \
  --email owner@example.com --name "Owner" --password "a-long-password"
```

Run PostgreSQL, Redis, the web process, and the worker as persistent services. Do not deploy the worker to a serverless function. Put the app behind HTTPS so Meta can reach the webhook, and expose the webhook endpoint publicly while keeping the CRM authenticated. Use a private S3 bucket and retain the database encryption keys outside the repository.

Backups must include PostgreSQL and media storage. Verify restores into a separate environment before relying on them. `WHATSAPP_AUTH_MASTER_KEY` must remain stable across worker deployments or linked sessions become unreadable.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run test:a11y
npm run test:visual
npm run build
```

E2E and visual checks expect a running web server and owner credentials in `.env.local`. Messaging E2E uses a development-only mock transport: start the worker with `WHATSAPP_TRANSPORT=mock`. It is ignored in production. Live delivery still requires a real QR scan.
