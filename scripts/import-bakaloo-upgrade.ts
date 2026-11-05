// One-time, idempotent import of the signed/commercial Bakaloo upgrade record.
// It keeps the original PDF in R2, creates the project, and links the existing paid advance.
import { and, eq, ilike } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { db, pool } from '../src/server/db/client';
import { clients, dealDocuments, invoices, projectMilestones, projects } from '../src/server/db/schema';
import { attachDealFile, createDeal, createProjectFromAgreement, updateProject } from '../src/server/services/deals/store';

const PDF_PATH = process.argv[2];
const TITLE = 'Bakaloo B2B Expansion + CRM, WhatsApp & POS Upgrade Agreement';

async function main() {
  if (!PDF_PATH) throw new Error('Pass the original proposal PDF path.');
  const [client] = await db.select().from(clients).where(ilike(clients.company, '%Bakaloo%')).limit(1);
  if (!client) throw new Error('Bakaloo client was not found.');
  const [invoice] = await db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.clientId, client.id), eq(invoices.number, 'SL/ADV/26-27/104'))).limit(1);
  if (!invoice) throw new Error('Paid advance SL/ADV/26-27/104 was not found for Bakaloo.');

  const [existing] = await db.select({ id: dealDocuments.id }).from(dealDocuments).where(and(eq(dealDocuments.workspaceId, client.workspaceId), eq(dealDocuments.title, TITLE))).limit(1);
  let agreementId = existing?.id;
  if (!agreementId) {
    agreementId = await createDeal(client.workspaceId, {
      kind: 'agreement',
      clientId: client.id,
      title: TITLE,
      reference: 'Commercial proposal dated 04 September 2026',
      status: 'draft',
      baseRupees: 50_000,
      gstRatePct: 18,
      issuedOn: '2026-09-04',
      durationDays: 90,
      brief: 'Separate B2B buying and pricing layer for the existing Bakaloo platform, plus connected CRM, WhatsApp Business operations and POS billing. The existing B2C experience remains independent.',
      milestones: [
        { title: 'Milestone 1 — B2B module and separate B2B pricing', trigger: 'Kickoff advance received; B2B scope, independent pricing and required backend/API changes.', amountRupees: 20_000, dueOn: '2026-09-09' },
        { title: 'Milestone 2 — CRM, WhatsApp integration and POS system', trigger: 'UAT, final delivery and handover of the CRM, WhatsApp operating layer and POS system.', amountRupees: 30_000, dueOn: null },
      ],
      content: null,
    });
    await attachDealFile(client.workspaceId, agreementId, await readFile(PDF_PATH), 'Shotlin_Bakaloo_B2B_CRM_POS_Upgrade_Proposal.pdf');
  }

  const [existingProject] = await db.select({ id: projects.id }).from(projects).where(eq(projects.agreementId, agreementId)).limit(1);
  const projectId = existingProject?.id ?? await createProjectFromAgreement(client.workspaceId, agreementId, '2026-09-09');
  await updateProject(client.workspaceId, projectId, {
    title: 'Bakaloo B2B Expansion + CRM, WhatsApp & POS Upgrade',
    roadmap: [
      { id: 'bakaloo-b2b', title: 'B2B module and separate B2B pricing', detail: 'Dedicated B2B experience, independent pricing, admin controls and connected ordering.', dueOn: null, status: 'in_progress' },
      { id: 'bakaloo-crm-pos', title: 'CRM, WhatsApp and POS suite', detail: 'Connected customer operations, approved WhatsApp workflows and counter/POS billing.', dueOn: null, status: 'planned' },
    ],
  });
  const milestones = await db.select().from(projectMilestones).where(eq(projectMilestones.projectId, projectId));
  const first = milestones.find((m) => m.position === 0);
  if (!first) throw new Error('The first project milestone was not created.');
  await db.update(projectMilestones).set({ invoiceId: invoice.id, status: 'in_progress' }).where(eq(projectMilestones.id, first.id));
  console.log(JSON.stringify({ agreementId, projectId, linkedInvoice: 'SL/ADV/26-27/104' }));
}

try {
  await main();
} finally {
  await pool.end();
}
