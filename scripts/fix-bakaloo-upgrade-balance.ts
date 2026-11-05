// Corrects the accepted Bakaloo package to the ₹30,000 CRM/WhatsApp/POS scope:
// ₹20,000 paid advance (existing ADV/104) + ₹10,000 final balance draft.
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../src/server/db/client';
import { dealDocuments, invoices, projectMilestones, projects } from '../src/server/db/schema';
import { linkMilestoneInvoice, updateProject } from '../src/server/services/deals/store';
import { createGstInvoice } from '../src/server/services/invoicing/issue';
import type { GstInvoiceInput } from '../src/server/services/invoicing/validate';

const PROJECT_ID = 'project-6db74482-1e0d-49c0-a77c-78a13122f549';

async function main() {
  const [project] = await db.select().from(projects).where(eq(projects.id, PROJECT_ID)).limit(1);
  if (!project || !project.agreementId) throw new Error('Bakaloo project/agreement not found.');
  const [advance] = await db.select().from(invoices).where(and(eq(invoices.workspaceId, project.workspaceId), eq(invoices.number, 'SL/ADV/26-27/104'))).limit(1);
  if (!advance) throw new Error('Paid advance SL/ADV/26-27/104 not found.');
  const rows = await db.select().from(projectMilestones).where(eq(projectMilestones.projectId, project.id));
  const first = rows.find((row) => row.position === 0);
  const second = rows.find((row) => row.position === 1);
  if (!first || !second) throw new Error('The two expected milestones were not found.');

  // The source PDF contains a larger two-package commercial proposal. This project tracks only its
  // accepted CRM/WhatsApp/POS package, whose existing advance itself says total ₹30,000 / advance ₹20,000.
  await db.update(dealDocuments).set({
    title: 'Bakaloo CRM, WhatsApp & POS Upgrade Agreement',
    reference: 'Accepted ₹30,000 package from the commercial proposal dated 04 September 2026',
    baseAmountMinor: 3_000_000,
    brief: 'Accepted scope: connected customer CRM, WhatsApp Business operating workflows and POS billing for Bakaloo. The attached original PDF remains the source commercial proposal; this project records only the selected ₹30,000 package.',
    updatedAt: new Date(),
  }).where(eq(dealDocuments.id, project.agreementId));

  await db.update(projectMilestones).set({
    title: 'Milestone 1 — CRM, WhatsApp & POS advance received',
    trigger: '₹20,000 advance received under SL/ADV/26-27/104 on 09 September 2026.',
    baseMinor: 2_000_000,
    shareBp: 6667,
    invoiceId: advance.id,
    status: 'in_progress',
  }).where(eq(projectMilestones.id, first.id));
  await db.update(projectMilestones).set({
    title: 'Milestone 2 — Final delivery balance',
    trigger: 'Final CRM, WhatsApp and POS delivery, UAT acceptance and handover.',
    baseMinor: 1_000_000,
    shareBp: 3333,
    status: 'planned',
  }).where(eq(projectMilestones.id, second.id));
  await updateProject(project.workspaceId, project.id, {
    title: 'Bakaloo CRM, WhatsApp & POS Upgrade',
    brief: 'Accepted ₹30,000 package: connected CRM, WhatsApp Business operating workflows and POS billing. ₹20,000 advance was received under SL/ADV/26-27/104; ₹10,000 remains as the final delivery balance.',
    roadmap: [
      { id: 'bakaloo-crm-pos-build', title: 'CRM, WhatsApp and POS implementation', detail: 'Connected customer operations, approved WhatsApp workflows and counter/POS billing.', dueOn: null, status: 'in_progress' },
      { id: 'bakaloo-final-handover', title: 'UAT, final delivery and handover', detail: 'Final review, acceptance and project handover after the ₹10,000 balance invoice.', dueOn: null, status: 'planned' },
    ],
  });

  const [already] = await db.select({ id: invoices.id, number: invoices.number }).from(invoices).where(eq(invoices.id, second.invoiceId ?? '')).limit(1);
  if (already) {
    console.log(JSON.stringify({ projectId: project.id, finalInvoiceId: already.id, number: already.number, reused: true }));
    return;
  }
  if (!advance.customer || !advance.project) throw new Error('The existing advance is missing billing details.');
  const projectInfo = advance.project as GstInvoiceInput['project'];
  const final = await createGstInvoice(project.workspaceId, {
    clientId: advance.clientId,
    docType: 'final',
    issuedAt: new Date(),
    taxRatePct: advance.taxRatePct,
    sac: advance.sac,
    paymentTerms: 'Due before final delivery / handover',
    customer: advance.customer as GstInvoiceInput['customer'],
    project: {
      ...projectInfo,
      name: 'Bakaloo CRM, WhatsApp & POS Upgrade',
      reference: 'Accepted ₹30,000 package from proposal dated 04 September 2026',
      advanceRef: 'SL/ADV/26-27/104 dated 09 September 2026',
      advanceNote: '₹20,000 advance already received and adjusted in this final invoice.',
    },
    lines: [{
      description: 'Bakaloo CRM, WhatsApp & POS Upgrade — final delivery balance',
      detail: 'Balance after adjusting the ₹20,000 advance received under SL/ADV/26-27/104.',
      qty: 1,
      unitPriceMinor: 1_000_000,
    }],
    projectTaxableMinor: 3_000_000,
    advanceTaxableMinor: 2_000_000,
    adjustmentNote: 'Project value ₹30,000 less advance received ₹20,000. Final taxable balance ₹10,000.',
  });
  await linkMilestoneInvoice(project.workspaceId, second.id, final.id);
  console.log(JSON.stringify({ projectId: project.id, finalInvoiceId: final.id, number: final.docNo, draft: true }));
}

try {
  await main();
} finally {
  await pool.end();
}
