import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../../db/client';
import { clients, dealDocuments, invoiceItems, invoices, leads, payments, projectMilestones, projects } from '../../db/schema';
import { deletePrivateMedia, putPrivateMedia } from '../../storage';
import { gstModelFromRows } from '../invoicing/model';
import { gstOf, shareBp } from './milestones';

const DAY = 86_400_000;
const ymd = (value: Date | null) => (value ? new Date(value.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : null);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
const atIst = (value: string) => new Date(`${value}T00:00:00+05:30`);
const toPaise = (rupees: number) => Math.round(rupees * 100);

export const milestoneInputSchema = z.object({
  title: z.string().trim().min(1, 'Name every milestone').max(200),
  trigger: z.string().trim().max(600).default(''),
  amountRupees: z.number().positive('Every milestone needs an amount'),
  dueOn: date.nullable().optional(),
});

export const dealInputSchema = z
  .object({
    kind: z.enum(['proposal', 'agreement']),
    clientId: z.string().min(1).nullable().optional(),
    leadId: z.string().min(1).nullable().optional(),
    title: z.string().trim().min(1, 'Give it a title').max(300),
    reference: z.string().trim().max(120).default(''),
    status: z.enum(['draft', 'sent', 'signed', 'declined']).default('draft'),
    baseRupees: z.number().positive('Enter the project cost before GST'),
    gstRatePct: z.number().int().min(0).max(28).default(18),
    issuedOn: date.nullable().optional(),
    signedOn: date.nullable().optional(),
    durationDays: z.number().int().min(1).max(1500).nullable().optional(),
    brief: z.string().trim().max(10_000).default(''),
    sourceDocumentId: z.string().min(1).nullable().optional(),
    milestones: z.array(milestoneInputSchema).max(12).default([]),
  })
  .superRefine((value, ctx) => {
    if (!value.clientId && !value.leadId) ctx.addIssue({ code: 'custom', path: ['clientId'], message: 'Choose the client or the lead' });
    if (value.milestones.length > 0) {
      const sum = value.milestones.reduce((total, m) => total + toPaise(m.amountRupees), 0);
      if (sum !== toPaise(value.baseRupees)) {
        ctx.addIssue({ code: 'custom', path: ['milestones'], message: 'The milestone amounts must add up to the project cost' });
      }
    }
  });
export type DealInput = z.infer<typeof dealInputSchema>;

const fields = (input: DealInput) => ({
  clientId: input.clientId ?? null,
  leadId: input.leadId ?? null,
  kind: input.kind,
  title: input.title,
  reference: input.reference,
  status: input.status,
  baseAmountMinor: toPaise(input.baseRupees),
  gstRatePct: input.gstRatePct,
  issuedOn: input.issuedOn ? atIst(input.issuedOn) : null,
  signedOn: input.signedOn ? atIst(input.signedOn) : null,
  durationDays: input.durationDays ?? null,
  brief: input.brief,
  sourceDocumentId: input.sourceDocumentId ?? null,
});

const milestoneRows = (workspaceId: string, documentId: string, input: DealInput) =>
  input.milestones.map((m, position) => ({
    id: `milestone-${randomUUID()}`,
    workspaceId,
    documentId,
    position,
    title: m.title,
    trigger: m.trigger,
    shareBp: shareBp(toPaise(m.amountRupees), toPaise(input.baseRupees)),
    baseMinor: toPaise(m.amountRupees),
    dueOn: m.dueOn ? atIst(m.dueOn) : null,
  }));

async function assertParties(workspaceId: string, input: DealInput) {
  if (input.clientId) {
    const [row] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, input.clientId), eq(clients.workspaceId, workspaceId))).limit(1);
    if (!row) throw new Error('Client not found');
  }
  if (input.leadId) {
    const [row] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, input.leadId), eq(leads.workspaceId, workspaceId))).limit(1);
    if (!row) throw new Error('Lead not found');
  }
}

export async function createDeal(workspaceId: string, input: DealInput) {
  await assertParties(workspaceId, input);
  const id = `deal-${randomUUID()}`;
  await db.transaction(async (tx) => {
    await tx.insert(dealDocuments).values({ id, workspaceId, ...fields(input) });
    if (input.milestones.length) await tx.insert(projectMilestones).values(milestoneRows(workspaceId, id, input));
  });
  return id;
}

export async function updateDeal(workspaceId: string, id: string, input: DealInput) {
  await assertParties(workspaceId, input);
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(dealDocuments).where(and(eq(dealDocuments.id, id), eq(dealDocuments.workspaceId, workspaceId))).for('update').limit(1);
    if (!existing) throw new Error('Not found');
    await tx.update(dealDocuments).set({ ...fields(input), kind: existing.kind, updatedAt: new Date() }).where(eq(dealDocuments.id, id));
    // Once a project exists the milestones live on the project and are changed there.
    const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.agreementId, id)).limit(1);
    if (!project) {
      await tx.delete(projectMilestones).where(eq(projectMilestones.documentId, id));
      if (input.milestones.length) await tx.insert(projectMilestones).values(milestoneRows(workspaceId, id, input));
    }
  });
}

export async function attachDealFile(workspaceId: string, id: string, buffer: Buffer, filename: string) {
  if (buffer.length === 0 || buffer.length > 25 * 1024 * 1024) throw new Error('The PDF must be under 25 MB');
  if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('Only PDF files can be uploaded');
  const [existing] = await db.select().from(dealDocuments).where(and(eq(dealDocuments.id, id), eq(dealDocuments.workspaceId, workspaceId))).limit(1);
  if (!existing) throw new Error('Not found');
  // Stored compressed in R2, like every other file.
  const stored = await putPrivateMedia({ workspaceId, buffer, mimeType: 'application/pdf', filename, optimize: 'outgoing' });
  await db.update(dealDocuments).set({ fileKey: stored.objectKey, fileName: filename.slice(-160), fileSize: stored.sizeBytes, updatedAt: new Date() }).where(eq(dealDocuments.id, id));
  if (existing.fileKey) await deletePrivateMedia(existing.fileKey).catch(() => undefined);
  return stored.sizeBytes;
}

export async function deleteDeal(workspaceId: string, id: string) {
  const [existing] = await db.select().from(dealDocuments).where(and(eq(dealDocuments.id, id), eq(dealDocuments.workspaceId, workspaceId))).limit(1);
  if (!existing) throw new Error('Not found');
  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.agreementId, id)).limit(1);
  if (project) throw new Error('A project was created from this agreement, so it cannot be deleted');
  await db.delete(dealDocuments).where(eq(dealDocuments.id, id));
  if (existing.fileKey) await deletePrivateMedia(existing.fileKey).catch(() => undefined);
}

export async function listDeals(workspaceId: string) {
  const rows = await db
    .select({ doc: dealDocuments, client: clients.name, clientCompany: clients.company, lead: leads.name })
    .from(dealDocuments)
    .leftJoin(clients, eq(clients.id, dealDocuments.clientId))
    .leftJoin(leads, eq(leads.id, dealDocuments.leadId))
    .where(eq(dealDocuments.workspaceId, workspaceId))
    .orderBy(desc(dealDocuments.createdAt));
  const ids = rows.map((row) => row.doc.id);
  const projectRows = ids.length ? await db.select({ id: projects.id, agreementId: projects.agreementId }).from(projects).where(inArray(projects.agreementId, ids)) : [];
  return rows.map(({ doc, client, clientCompany, lead }) => ({
    id: doc.id,
    kind: doc.kind,
    title: doc.title,
    reference: doc.reference,
    status: doc.status,
    party: clientCompany || client || lead || '',
    isLead: !doc.clientId && Boolean(doc.leadId),
    baseAmountMinor: doc.baseAmountMinor,
    gstRatePct: doc.gstRatePct,
    totalMinor: doc.baseAmountMinor + gstOf(doc.baseAmountMinor, doc.gstRatePct),
    hasFile: Boolean(doc.fileKey),
    projectId: projectRows.find((p) => p.agreementId === doc.id)?.id ?? null,
    issuedOn: doc.issuedOn?.toISOString() ?? null,
    createdAt: doc.createdAt.toISOString(),
  }));
}

export async function getDeal(workspaceId: string, id: string) {
  const [doc] = await db.select().from(dealDocuments).where(and(eq(dealDocuments.id, id), eq(dealDocuments.workspaceId, workspaceId))).limit(1);
  if (!doc) return null;
  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.agreementId, id)).limit(1);
  const rows = await db
    .select()
    .from(projectMilestones)
    .where(project ? eq(projectMilestones.projectId, project.id) : eq(projectMilestones.documentId, id))
    .orderBy(asc(projectMilestones.position));
  return {
    id: doc.id,
    kind: doc.kind as 'proposal' | 'agreement',
    clientId: doc.clientId,
    leadId: doc.leadId,
    title: doc.title,
    reference: doc.reference,
    status: doc.status,
    baseAmountMinor: doc.baseAmountMinor,
    gstRatePct: doc.gstRatePct,
    issuedOn: ymd(doc.issuedOn),
    signedOn: ymd(doc.signedOn),
    durationDays: doc.durationDays,
    brief: doc.brief,
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    hasFile: Boolean(doc.fileKey),
    sourceDocumentId: doc.sourceDocumentId,
    projectId: project?.id ?? null,
    milestones: rows.map((m) => ({ id: m.id, title: m.title, trigger: m.trigger, baseMinor: m.baseMinor, dueOn: ymd(m.dueOn) })),
  };
}

export async function getDealFileKey(workspaceId: string, id: string) {
  const [doc] = await db.select({ key: dealDocuments.fileKey, name: dealDocuments.fileName }).from(dealDocuments).where(and(eq(dealDocuments.id, id), eq(dealDocuments.workspaceId, workspaceId))).limit(1);
  return doc?.key ? { key: doc.key, name: doc.name ?? 'document.pdf' } : null;
}

// Turns a signed agreement into a project. The payment milestones move across with it.
export async function createProjectFromAgreement(workspaceId: string, id: string, startsOn: string) {
  return db.transaction(async (tx) => {
    const [doc] = await tx.select().from(dealDocuments).where(and(eq(dealDocuments.id, id), eq(dealDocuments.workspaceId, workspaceId))).for('update').limit(1);
    if (!doc) throw new Error('Not found');
    if (doc.kind !== 'agreement') throw new Error('Only an agreement can start a project. Make an agreement from this proposal first.');
    const [existing] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.agreementId, id)).limit(1);
    if (existing) throw new Error('A project already exists for this agreement');

    // A project belongs to a client. If the agreement is still with a lead, the lead becomes a client now.
    let clientId = doc.clientId;
    if (!clientId && doc.leadId) {
      const [lead] = await tx.select().from(leads).where(and(eq(leads.id, doc.leadId), eq(leads.workspaceId, workspaceId))).limit(1);
      if (!lead) throw new Error('Lead not found');
      clientId = lead.clientId ?? `client-${randomUUID()}`;
      if (!lead.clientId) {
        await tx.insert(clients).values({ id: clientId, workspaceId, name: lead.name, company: lead.company || lead.name, email: lead.email, phone: lead.phone, city: lead.city });
        await tx.update(leads).set({ clientId }).where(eq(leads.id, lead.id));
      }
      await tx.update(dealDocuments).set({ clientId }).where(eq(dealDocuments.id, id));
    }
    if (!clientId) throw new Error('Choose a client or lead for this agreement first');

    const starts = atIst(startsOn);
    const projectId = `project-${randomUUID()}`;
    await tx.insert(projects).values({
      id: projectId,
      workspaceId,
      clientId,
      leadId: doc.leadId,
      agreementId: id,
      title: doc.title,
      status: 'active',
      brief: doc.brief,
      startsAt: starts,
      dueAt: new Date(starts.getTime() + (doc.durationDays ?? 60) * DAY),
    });
    await tx.update(projectMilestones).set({ projectId }).where(eq(projectMilestones.documentId, id));
    return projectId;
  });
}

// ---------------------------------------------------------------- projects

export const projectPatchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  status: z.enum(['active', 'on_hold', 'completed', 'cancelled']).optional(),
  brief: z.string().max(10_000).optional(),
  startsOn: date.nullable().optional(),
  dueOn: date.optional(),
  roadmap: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        title: z.string().trim().min(1).max(200),
        detail: z.string().trim().max(1000).default(''),
        dueOn: date.nullable().default(null),
        status: z.enum(['planned', 'in_progress', 'done']).default('planned'),
      }),
    )
    .max(40)
    .optional(),
});

export const milestonePatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  trigger: z.string().trim().max(600).optional(),
  dueOn: date.nullable().optional(),
  status: z.enum(['planned', 'in_progress', 'delivered', 'accepted']).optional(),
});

export async function updateProject(workspaceId: string, id: string, patch: z.infer<typeof projectPatchSchema>) {
  const set: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.status !== undefined) {
    set.status = patch.status;
    set.completedAt = patch.status === 'completed' ? new Date() : null;
  }
  if (patch.brief !== undefined) set.brief = patch.brief;
  if (patch.startsOn !== undefined) set.startsAt = patch.startsOn ? atIst(patch.startsOn) : null;
  if (patch.dueOn !== undefined) set.dueAt = atIst(patch.dueOn);
  if (patch.roadmap !== undefined) set.roadmap = patch.roadmap;
  const result = await db.update(projects).set(set).where(and(eq(projects.id, id), eq(projects.workspaceId, workspaceId))).returning({ id: projects.id });
  if (result.length === 0) throw new Error('Project not found');
}

export async function updateMilestone(workspaceId: string, projectId: string, milestoneId: string, patch: z.infer<typeof milestonePatchSchema>) {
  const set: Partial<typeof projectMilestones.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.trigger !== undefined) set.trigger = patch.trigger;
  if (patch.dueOn !== undefined) set.dueOn = patch.dueOn ? atIst(patch.dueOn) : null;
  if (patch.status !== undefined) set.status = patch.status;
  if (Object.keys(set).length === 0) return;
  const result = await db
    .update(projectMilestones)
    .set(set)
    .where(and(eq(projectMilestones.id, milestoneId), eq(projectMilestones.projectId, projectId), eq(projectMilestones.workspaceId, workspaceId)))
    .returning({ id: projectMilestones.id });
  if (result.length === 0) throw new Error('Milestone not found');
}

export async function linkMilestoneInvoice(workspaceId: string, milestoneId: string, invoiceId: string) {
  await db
    .update(projectMilestones)
    .set({ invoiceId })
    .where(and(eq(projectMilestones.id, milestoneId), eq(projectMilestones.workspaceId, workspaceId), sql`${projectMilestones.invoiceId} is null`));
}

export async function listProjectsWithProgress(workspaceId: string) {
  const rows = await db
    .select({ project: projects, client: clients.name, company: clients.company })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(eq(projects.workspaceId, workspaceId))
    .orderBy(desc(projects.createdAt));
  const ms = rows.length
    ? await db.select().from(projectMilestones).where(inArray(projectMilestones.projectId, rows.map((r) => r.project.id)))
    : [];
  return rows.map(({ project, client, company }) => {
    const mine = ms.filter((m) => m.projectId === project.id);
    return {
      id: project.id,
      title: project.title,
      status: project.status,
      client: company || client,
      startsOn: ymd(project.startsAt),
      dueOn: ymd(project.dueAt),
      milestonesTotal: mine.length,
      milestonesAccepted: mine.filter((m) => m.status === 'accepted').length,
      totalMinor: mine.reduce((sum, m) => sum + m.baseMinor, 0),
      invoicedMinor: mine.filter((m) => m.invoiceId).reduce((sum, m) => sum + m.baseMinor, 0),
    };
  });
}

export async function getProjectDetail(workspaceId: string, id: string) {
  const [row] = await db
    .select({ project: projects, client: clients })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projects.id, id), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return null;
  const { project, client } = row;
  const ms = await db.select().from(projectMilestones).where(eq(projectMilestones.projectId, id)).orderBy(asc(projectMilestones.position));
  const invoiceIds = ms.map((m) => m.invoiceId).filter((value): value is string => Boolean(value));
  const invoiceRows = invoiceIds.length ? await db.select().from(invoices).where(inArray(invoices.id, invoiceIds)) : [];
  const items = invoiceIds.length ? await db.select().from(invoiceItems).where(inArray(invoiceItems.invoiceId, invoiceIds)) : [];
  const paid = invoiceIds.length
    ? await db.select({ invoiceId: payments.invoiceId, total: sql<number>`sum(${payments.amountMinor})::bigint` }).from(payments).where(inArray(payments.invoiceId, invoiceIds)).groupBy(payments.invoiceId)
    : [];
  const [agreement] = project.agreementId
    ? await db.select({ id: dealDocuments.id, title: dealDocuments.title, gstRatePct: dealDocuments.gstRatePct, hasFile: sql<boolean>`${dealDocuments.fileKey} is not null` }).from(dealDocuments).where(eq(dealDocuments.id, project.agreementId)).limit(1)
    : [];
  const rate = agreement?.gstRatePct ?? 18;
  return {
    id: project.id,
    title: project.title,
    status: project.status,
    brief: project.brief,
    startsOn: ymd(project.startsAt),
    dueOn: ymd(project.dueAt),
    roadmap: project.roadmap,
    client: { id: client.id, name: client.name, company: client.company },
    agreement: agreement ? { id: agreement.id, title: agreement.title, hasFile: agreement.hasFile } : null,
    gstRatePct: rate,
    milestones: ms.map((m, index) => {
      const invoice = invoiceRows.find((i) => i.id === m.invoiceId);
      const received = Number(paid.find((p) => p.invoiceId === m.invoiceId)?.total ?? 0);
      const built = invoice ? gstModelFromRows(invoice, items.filter((i) => i.invoiceId === invoice.id), received) : null;
      return {
        id: m.id,
        index,
        title: m.title,
        trigger: m.trigger,
        baseMinor: m.baseMinor,
        grossMinor: m.baseMinor + gstOf(m.baseMinor, rate),
        dueOn: ymd(m.dueOn),
        status: m.status,
        invoice: invoice
          ? { id: invoice.id, number: invoice.number, status: built?.model.paymentStatus ?? invoice.status, cancelled: Boolean(invoice.cancelledAt), receivedMinor: received }
          : null,
      };
    }),
  };
}
