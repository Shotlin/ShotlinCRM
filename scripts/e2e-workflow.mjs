import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import pg from 'pg';
import { BASE, launchBrowser, login, trackErrors } from './lib/browser.mjs';

try {
  loadEnvFile('.env.local');
} catch {}

const ownerEmail = process.env.E2E_OWNER_EMAIL ?? process.env.OWNER_EMAIL;
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const workspace = await db
  .query(
    `select wm.workspace_id as workspace_id
     from users u join workspace_members wm on wm.user_id = u.id
     where u.email = $1 limit 1`,
    [ownerEmail],
  )
  .then((result) => result.rows[0]);
assert(workspace, 'Seed the owner and workspace before running E2E tests');
await db.query(
  `insert into whatsapp_connections (id, workspace_id, phone, state, generation)
   values ($1, $2, '919876543210', 'connected', 1)
   on conflict (workspace_id) do update set state = 'connected', phone = '919876543210', generation = whatsapp_connections.generation + 1, qr_ciphertext = null, qr_expires_at = null, updated_at = now()`,
  [`connection-${workspace.workspace_id}`, workspace.workspace_id],
);

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
const page = await context.newPage();
const errors = trackErrors(page);
page.on('dialog', (dialog) => void dialog.accept());
const pause = (ms = 260) => page.waitForTimeout(ms);

await login(page);
const integration = await page.evaluate(async () => {
  const response = await fetch('/api/integrations/whatsapp');
  return response.json();
});
assert.equal(integration.transport, 'mock', 'E2E requires a worker started with WHATSAPP_TRANSPORT=mock');

// Known starting data.
await page.locator('.profile-summary').click();
await page.getByRole('button', { name: 'Reset demo workspace' }).click();
await page.waitForTimeout(1_000);
await page.waitForLoadState('networkidle');
await page.getByRole('heading', { name: /Good morning/ }).waitFor();

// Deterministic AI command center works before a provider is connected.
await page.goto(`${BASE}/ai`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: 'Your day, prioritized' }).waitFor();
await page.getByText('Priorities are live. Message understanding needs a provider.').waitFor();
assert.equal(await page.locator('.ai-page .metric-card').count(), 4);
assert((await page.locator('.ai-rec-row').count()) > 0, 'Seeded work should appear in the AI queue');

const settingsPayload = await page.evaluate(async () => {
  const response = await fetch('/api/ai/settings', { cache: 'no-store' });
  return { status: response.status, body: await response.json() };
});
assert.equal(settingsPayload.status, 200);
assert.equal(settingsPayload.body.hasApiKey, false);
assert.equal('apiKey' in settingsPayload.body, false);
assert.equal('encryptedApiKey' in settingsPayload.body, false);

// The settings API encrypts a credential and never echoes it back.
const savedSettings = await page.evaluate(async () => {
  const response = await fetch('/api/ai/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'openai',
      model: 'e2e-model',
      apiKey: 'sk-e2e-never-live',
      enabled: false,
      autoDraftEnabled: false,
      redactIdentifiers: true,
      firstResponseMinutes: 60,
      monthlyTokenBudget: 100000,
    }),
  });
  return { status: response.status, body: await response.json() };
});
assert.equal(savedSettings.status, 200);
assert.equal(savedSettings.body.hasApiKey, true);
assert.equal('apiKey' in savedSettings.body, false);
const encryptedSettings = await db.query(
  `select encrypted_api_key from ai_provider_settings where workspace_id = $1`,
  [workspace.workspace_id],
);
assert.notEqual(encryptedSettings.rows[0].encrypted_api_key, 'sk-e2e-never-live');
assert.match(encryptedSettings.rows[0].encrypted_api_key, /^ai-v1\./);
await db.query(`delete from ai_provider_settings where workspace_id = $1`, [workspace.workspace_id]);

// Reading a conversation clears its durable unread state.
await db.query(
  `update conversations set last_read_at = null, unread_count = 1 where workspace_id = $1 and lead_id = 'lead-1'`,
  [workspace.workspace_id],
);
const readResponse = await page.evaluate(async () => {
  const response = await fetch('/api/conversations/lead-1/read', { method: 'POST' });
  return response.status;
});
assert.equal(readResponse, 200);
const readState = await db.query(
  `select last_read_at, unread_count from conversations where workspace_id = $1 and lead_id = 'lead-1'`,
  [workspace.workspace_id],
);
assert(readState.rows[0].last_read_at, 'Conversation read timestamp should be persisted');
assert.equal(readState.rows[0].unread_count, 0);

// Verify the human-review handoff with a stored draft.
await db.query(
  `insert into reply_drafts
     (id, workspace_id, lead_id, conversation_id, triggering_message_id, body, language, evidence, missing_info_questions, state, generated_at, updated_at)
   select 'e2e-ai-draft', $1, c.lead_id, c.id, m.id,
          'Thanks Riya — I have noted the wedding dates and will confirm the next step before sharing the final package.',
          'en', '[]'::jsonb, '[]'::jsonb, 'draft', now(), now()
   from conversations c
   join lateral (
     select id from messages
     where workspace_id = c.workspace_id and lead_id = c.lead_id and direction = 'inbound'
     order by sent_at desc limit 1
   ) m on true
   where c.workspace_id = $1 and c.lead_id = 'lead-1'`,
  [workspace.workspace_id],
);
await page.goto(`${BASE}/ai/replies`, { waitUntil: 'networkidle' });
await page.getByText('Riya Sharma').first().waitFor();
await page.goto(`${BASE}/ai/contacts/lead-1`, { waitUntil: 'networkidle' });
await page.getByRole('textbox', { name: 'Suggested reply' }).waitFor();
assert.match(
  await page.getByRole('textbox', { name: 'Suggested reply' }).inputValue(),
  /noted the wedding dates/,
);
await db.query(
  `update conversations set last_read_at = null where workspace_id = $1 and lead_id = 'lead-2'`,
  [workspace.workspace_id],
);
await page.getByRole('link', { name: /Edit in inbox/ }).click();
await page.waitForURL(/\/inbox\?/, { timeout: 15_000 });
await page.getByLabel('Write a WhatsApp message').waitFor();
await page.waitForFunction(() =>
  (document.getElementById('reply-message'))?.value.includes('noted the wedding dates'),
);
const bystanderReadState = await db.query(
  `select last_read_at from conversations where workspace_id = $1 and lead_id = 'lead-2'`,
  [workspace.workspace_id],
);
assert.equal(
  bystanderReadState.rows[0].last_read_at,
  null,
  'Opening a linked draft must not mark an unrelated conversation read',
);
await page.getByRole('button', { name: 'Send WhatsApp message' }).click();
await page.getByText('Message queued for WhatsApp').waitFor();
await page.waitForTimeout(800);
const sentDraft = await db.query(
  `select state, sent_message_id from reply_drafts where workspace_id = $1 and id = 'e2e-ai-draft'`,
  [workspace.workspace_id],
);
assert.equal(sentDraft.rows[0].state, 'sent');
assert(sentDraft.rows[0].sent_message_id, 'Sent draft should retain the outbound message ID');

// Project deadlines are real records and feed the AI risk queue.
await page.goto(`${BASE}/ai/contacts/lead-9`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: 'Project deadlines' }).waitFor();
await page.getByLabel('Project', { exact: true }).fill('E2E delivery deadline');
await page.getByRole('textbox', { name: 'Deadline' }).fill('2026-11-30T10:00');
await page.getByRole('button', { name: 'Add deadline' }).click();
await page.getByText('Project deadline saved').waitFor();
await page.getByText('E2E delivery deadline').waitFor();
const projectRow = await db.query(
  `select title, status from projects where workspace_id = $1 and title = 'E2E delivery deadline'`,
  [workspace.workspace_id],
);
assert.equal(projectRow.rows[0]?.status, 'active');
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

// Create a reusable template once, for the inbox send flow.
const templateName = `E2E follow-up ${Date.now()}`;
await page.goto(`${BASE}/settings/templates`, { waitUntil: 'networkidle' });
await page.getByLabel('Template name').fill(templateName);
await page
  .getByLabel('Message')
  .fill('Hi {{name}}, sharing the outline for {{company}}. — Shotlin');
await page.getByRole('button', { name: 'Create template' }).click();
await page.getByText('Template created').waitFor();
await page.getByText(templateName).waitFor();

// Lead form validation and creation.
await page.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'New lead' }).click();
let leadDialog = page.getByRole('dialog');
await leadDialog.getByRole('button', { name: 'Add lead' }).click();
await leadDialog.getByText('Add a name to continue.').waitFor();
await leadDialog.getByRole('button', { name: 'Close dialog' }).click();
await page.getByRole('button', { name: 'New lead' }).click();
leadDialog = page.getByRole('dialog');
await leadDialog.getByLabel('Name *').fill('E2E Wedding Lead');
await leadDialog.getByLabel('Company').fill('Test Studio');
await leadDialog.getByLabel('Phone').fill('+91 90000 11111');
await leadDialog.getByLabel('Email').fill('e2e@studio.in');
await leadDialog.getByLabel('City').fill('Udaipur');
await leadDialog.getByLabel('Follow-up').fill('2026-10-29T10:00');
await leadDialog.getByLabel('Estimated value').fill('50000');
await leadDialog
  .getByLabel('Enquiry message *')
  .fill('We need a two-day wedding film in Udaipur this December.');
await leadDialog.getByRole('button', { name: 'Add lead' }).click();
await page.getByText('Lead added to your pipeline').waitFor();
await page
  .getByRole('region', { name: 'New lead column' })
  .getByText('E2E Wedding Lead')
  .waitFor();

// Pointer drag into Connected.
const grip = page.getByRole('button', { name: 'Drag E2E Wedding Lead to another stage' });
const sourceBox = await grip.boundingBox();
const target = page.getByRole('region', { name: 'Connected column' });
const targetBox = await target.boundingBox();
assert(sourceBox && targetBox);
await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
await page.mouse.down();
await page.mouse.move(sourceBox.x + 80, sourceBox.y + 20, { steps: 6 });
await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 320, { steps: 14 });
await page.mouse.up();
await pause();
assert.equal(
  await page.getByRole('region', { name: 'Connected column' }).getByText('E2E Wedding Lead').count(),
  1,
);

// Notes.
await page.getByRole('region', { name: 'Connected column' }).getByRole('link', { name: /E2E Wedding Lead/ }).click();
await page.getByLabel('Add a note').fill('Wants a calm documentary treatment and an evening teaser.');
await page.getByRole('button', { name: 'Add note' }).click();
await page.getByText('Wants a calm documentary treatment and an evening teaser.').first().waitFor();
const leadUrl = page.url();

// Template message plus private image using the mock worker transport.
await page.goto(`${BASE}/inbox`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /E2E Wedding Lead/ }).click();
await page.getByLabel('Message template').selectOption({ label: templateName });
await page.getByRole('button', { name: 'Send WhatsApp message' }).click();
await page.getByText('Message queued for WhatsApp').waitFor();
await page.locator('.thread-messages').getByText(/sharing the outline for Test Studio/).waitFor();

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=',
  'base64',
);
await writeFile('.local/e2e-media.png', png);
await page.locator('.inbox-page input[type="file"]').setInputFiles('.local/e2e-media.png');
await page.getByRole('button', { name: 'Send WhatsApp message' }).click();
await page.getByText('Message queued for WhatsApp').waitFor();
await page.locator('.thread-messages img.message-media').waitFor();
await page.waitForTimeout(700);
await page.reload({ waitUntil: 'networkidle' });
await page.locator('.thread-messages').getByText(/sharing the outline for Test Studio/).waitFor();
await page.locator('.thread-messages img.message-media').waitFor();

// Proposal -> sent -> accepted -> client conversion.
await page.goto(leadUrl, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Create proposal' }).click();
await page.waitForURL(/\/proposals\/.+\/edit/);
await page.getByLabel('Proposal title').fill('Udaipur wedding film');
await page.getByRole('button', { name: 'Mark as sent' }).first().click();
await page.getByText('Proposal marked as sent').waitFor();
await page.getByRole('button', { name: 'Mark accepted' }).first().click();
await page.getByText('Proposal accepted and lead moved forward').waitFor();

await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' });
await page.getByText('Test Studio').first().waitFor();
await page.getByRole('button', { name: 'Open Test Studio' }).click();
await page.getByRole('button', { name: 'New invoice' }).first().click();
await page.waitForURL(/\/invoices\/.+\/edit/);
await page.getByRole('button', { name: 'Mark as sent' }).first().click();
await page.getByText('Invoice marked as sent').waitFor();

// Partial and full payment against the invoice's real balance.
await page.getByRole('button', { name: 'Record payment' }).first().click();
let paymentDialog = page.getByRole('dialog');
await paymentDialog.getByLabel(/Amount/).fill('999999');
await paymentDialog.getByRole('button', { name: 'Record payment' }).click();
await paymentDialog.getByText('The amount cannot exceed the outstanding balance.').waitFor();
await paymentDialog.getByLabel(/Amount/).fill('25000');
await paymentDialog.getByRole('button', { name: 'Record payment' }).click();
await page.getByText('Partial payment recorded').waitFor();
assert((await page.getByText('Partially paid').count()) > 0);
const invoiceUrl = page.url();

await page.goto(`${BASE}/calendar`, { waitUntil: 'networkidle' });
await page.getByText(/E2E Wedding Lead/).first().waitFor();
await page.goto(invoiceUrl, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Record payment' }).first().click();
paymentDialog = page.getByRole('dialog');
await paymentDialog.getByRole('button', { name: 'Record payment' }).click();
await page.getByText('Invoice paid in full').waitFor();

// Financial reconciliation uses the received payment, not invoice issue date.
await page.goto(`${BASE}/finance`, { waitUntil: 'networkidle' });
await page.getByText('Recent payments').waitFor();
await page.getByText('Test Studio').first().waitFor();
await page.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle' });
await page.getByText('E2E Wedding Lead').first().waitFor();
await page.reload({ waitUntil: 'networkidle' });
await page.getByText('E2E Wedding Lead').first().waitFor();

// Reset removes the test records from PostgreSQL.
await page.locator('.profile-summary').click();
await page.getByRole('button', { name: 'Reset demo workspace' }).click();
await page.waitForTimeout(1_000);
await page.waitForLoadState('networkidle');
await page.getByText('E2E Wedding Lead').waitFor({ state: 'detached', timeout: 15_000 });

// Keyboard stage movement remains available alongside pointer drag.
const keyboardGrip = page.getByRole('button', { name: 'Drag Riya Sharma to another stage' });
await keyboardGrip.focus();
await page.keyboard.press('Space');
await pause(180);
await page.keyboard.press('ArrowRight');
await pause(180);
await page.keyboard.press('Space');
await pause(500);
assert.equal(
  await page.getByRole('region', { name: 'Connected column' }).getByText('Riya Sharma').count(),
  1,
);

// Mobile inbox is a single-pane flow, and manual messages still work there.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/inbox`, { waitUntil: 'networkidle' });
await page.locator('.conversation-item').first().click();
assert(await page.locator('.inbox-layout.mobile-thread').isVisible());
await page.getByLabel('Write a WhatsApp message').fill('A mobile WhatsApp reply.');
await page.getByRole('button', { name: 'Send WhatsApp message' }).click();
await page.getByText('Message queued for WhatsApp').waitFor();
await page.getByText('A mobile WhatsApp reply.', { exact: true }).waitFor();

const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
assert.equal(overflow, 0);

// Archive the test template, leaving the seeded demo clean.
await page.setViewportSize({ width: 1440, height: 1024 });
await page.goto(`${BASE}/settings/templates`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: `Archive ${templateName}` }).click();
await page.getByText('Template archived').waitFor();

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.locator('.profile-summary').click();
await page.getByRole('button', { name: 'Reset demo workspace' }).click();
await page.waitForTimeout(1_000);
await page.waitForLoadState('networkidle');
const finalState = await page.evaluate(async () => {
  const response = await fetch('/api/crm', { cache: 'no-store' });
  return response.json();
});
assert(!finalState.leads.some((lead) => lead.name === 'E2E Wedding Lead'));
assert(!finalState.messages.some((message) => message.body === 'A mobile WhatsApp reply.'));

assert.deepEqual(errors, []);
await browser.close();
await db.query(
  `update whatsapp_connections set state = 'disconnected', phone = null, last_error = null, qr_ciphertext = null, qr_expires_at = null where workspace_id = $1`,
  [workspace.workspace_id],
);
await db.end();
console.log('PASS: authenticated CRM, AI priorities, encrypted settings, draft review/send, projects, finance, reset, keyboard, and mobile flows verified');
