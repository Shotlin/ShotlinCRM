// Creates a harmless, time-limited preview of the exact client signing interface.
// It is deliberately not linked to any project or invoice.
import { eq, ilike } from 'drizzle-orm';
import { db, pool } from '../src/server/db/client';
import { clients, dealDocuments } from '../src/server/db/schema';
import { createDeal } from '../src/server/services/deals/store';
import { createShareLink } from '../src/server/services/share/store';

async function main() {
  const [client] = await db.select().from(clients).where(ilike(clients.company, '%Bakaloo%')).limit(1);
  if (!client) throw new Error('Demo client not found');
  const title = 'DEMO ONLY — Final Delivery Acceptance Signing Experience';
  const [existing] = await db.select({ id: dealDocuments.id }).from(dealDocuments).where(eq(dealDocuments.title, title)).limit(1);
  const id = existing?.id ?? await createDeal(client.workspaceId, {
    kind: 'agreement', clientId: client.id, title, reference: 'UI preview only — not a commercial or legal document', status: 'draft',
    baseRupees: 1, gstRatePct: 0, issuedOn: '2026-11-03', durationDays: null,
    brief: 'A safe preview of the private delivery-signing page. Do not use this document for any real client acceptance.',
    milestones: [],
    content: [
      { id: 'demo-1', type: 'h1', text: 'DEMO ONLY — Client signing page preview' },
      { id: 'demo-2', type: 'p', text: 'This is a safe test document. It has no commercial, contractual or delivery effect. It exists only to show how a client receives, reads and signs a final delivery agreement.' },
      { id: 'demo-3', type: 'h1', text: 'What a real client sees' },
      { id: 'demo-4', type: 'bullets', text: 'Your branded private signing page\nThe delivery agreement PDF embedded on the page\nFull name and role fields\nSignature pad and consent checkbox\nApprove and sign button\nOption to request a change instead' },
      { id: 'demo-5', type: 'h1', text: 'Test mode' },
      { id: 'demo-6', type: 'p', text: 'You may draw and submit a test signature on this demo. The normal system will record it, but it does not affect a real project, invoice or client agreement.' },
    ],
  });
  const link = await createShareLink(client.workspaceId, 'agreement', id, '24-hour UI demo only', 1);
  console.log(JSON.stringify({ documentId: id, url: `https://crm.shotlin.in/s/${link.token}`, expiresAt: link.expiresAt.toISOString() }));
}

try { await main(); } finally { await pool.end(); }
