import { and, desc, eq, sql } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { db } from '../../db/client';
import { invoices, projectMilestones, projects, shareLinks } from '../../db/schema';
import { getProjectDetail } from '../deals/store';
import { documentHeading } from '../invoicing/calc';
import { loadGstInvoice } from '../invoicing/issue';

const DAY = 86_400_000;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

// The secret is 32 random bytes. Only its hash is stored, so a database leak does not expose working links.
export type ShareKind = 'project' | 'invoice';

export async function createShareLink(workspaceId: string, kind: ShareKind, targetId: string, label: string, days: number) {
  if (kind === 'project') {
    const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, targetId), eq(projects.workspaceId, workspaceId))).limit(1);
    if (!project) throw new Error('Project not found');
  } else {
    const [invoice] = await db.select({ status: invoices.status, cancelledAt: invoices.cancelledAt, docType: invoices.docType }).from(invoices).where(and(eq(invoices.id, targetId), eq(invoices.workspaceId, workspaceId))).limit(1);
    if (!invoice || !invoice.docType) throw new Error('Invoice not found');
    if (invoice.cancelledAt) throw new Error('A cancelled invoice cannot be shared');
    if (invoice.status === 'draft') throw new Error('Mark the invoice as issued (or the request as sent) before sharing it');
  }
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + Math.min(Math.max(days, 1), 180) * DAY);
  const id = `share-${randomUUID()}`;
  await db.insert(shareLinks).values({ id, workspaceId, kind, targetId, label: label.slice(0, 120), tokenHash: hash(token), expiresAt });
  return { id, token, expiresAt };
}

export async function listShareLinks(workspaceId: string, targetId: string) {
  const rows = await db.select().from(shareLinks).where(and(eq(shareLinks.workspaceId, workspaceId), eq(shareLinks.targetId, targetId))).orderBy(desc(shareLinks.createdAt));
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revoked: Boolean(row.revokedAt),
    expired: row.expiresAt < new Date(),
    viewCount: row.viewCount,
    lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
  }));
}

export async function revokeShareLink(workspaceId: string, id: string) {
  const result = await db.update(shareLinks).set({ revokedAt: new Date() }).where(and(eq(shareLinks.id, id), eq(shareLinks.workspaceId, workspaceId))).returning({ id: shareLinks.id });
  if (result.length === 0) throw new Error('Link not found');
}

// Unknown, revoked and expired links all look the same from outside.
export async function resolveShare(token: string, countView = false) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const [link] = await db.select().from(shareLinks).where(eq(shareLinks.tokenHash, hash(token))).limit(1);
  if (!link || link.revokedAt || link.expiresAt < new Date()) return null;
  if (countView) {
    await db.update(shareLinks).set({ viewCount: sql`${shareLinks.viewCount} + 1`, lastViewedAt: new Date() }).where(eq(shareLinks.id, link.id));
  }
  return link;
}

// Only what the client should see. No contact details, no internal notes, no other projects.
export async function loadPublicProject(workspaceId: string, projectId: string) {
  const detail = await getProjectDetail(workspaceId, projectId);
  if (!detail) return null;
  return {
    title: detail.title,
    status: detail.status,
    preparedFor: detail.client.company || detail.client.name,
    brief: detail.brief,
    startsOn: detail.startsOn,
    dueOn: detail.dueOn,
    roadmap: detail.roadmap.map((item) => ({ title: item.title, detail: item.detail, dueOn: item.dueOn, status: item.status })),
    agreement: detail.agreement?.hasFile ? { title: detail.agreement.title } : null,
    milestones: detail.milestones.map((m) => ({
      additional: m.kind === 'additional',
      title: m.title,
      trigger: m.trigger,
      baseMinor: m.baseMinor,
      grossMinor: m.grossMinor,
      dueOn: m.dueOn,
      status: m.status,
      invoice: m.invoice && !m.invoice.cancelled ? { id: m.invoice.id, number: m.invoice.number, status: m.invoice.status } : null,
    })),
  };
}

// An invoice may be downloaded through a link only if it belongs to one of that project's milestones.
export async function invoiceBelongsToLink(workspaceId: string, projectId: string, invoiceId: string) {
  const [row] = await db
    .select({ id: projectMilestones.id })
    .from(projectMilestones)
    .where(and(eq(projectMilestones.workspaceId, workspaceId), eq(projectMilestones.projectId, projectId), eq(projectMilestones.invoiceId, invoiceId)))
    .limit(1);
  return Boolean(row);
}

// What a client sees of one invoice. The number shown is whatever it is today, so a request that has since been paid shows its tax number.
export async function loadPublicInvoice(workspaceId: string, invoiceId: string) {
  try {
    const invoice = await loadGstInvoice(workspaceId, invoiceId);
    if (invoice.status === 'draft' || invoice.cancelled) return null;
    const { model, totals } = invoice;
    return {
      id: invoiceId,
      docNo: invoice.docNo,
      heading: documentHeading(model.docType, model.series),
      issuedOn: new Date(model.issuedAt.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10),
      customer: model.customer.name,
      project: model.project.name,
      paymentStatus: model.paymentStatus,
      taxLabel: totals.taxLabel,
      lines: model.lines.map((line) => ({ description: line.description, amountMinor: line.taxableMinor })),
      taxableMinor: totals.billableMinor,
      taxMinor: totals.taxMinor,
      roundOffMinor: totals.roundOffMinor,
      grandMinor: totals.grandMinor,
      receivedMinor: invoice.receivedMinor,
      balanceMinor: Math.max(0, totals.grandMinor - invoice.receivedMinor),
    };
  } catch {
    return null;
  }
}

// Whether an invoice may be downloaded through this link.
export async function invoiceAllowedForLink(link: { kind: string; workspaceId: string; targetId: string }, invoiceId: string) {
  if (link.kind === 'invoice') return link.targetId === invoiceId;
  if (link.kind === 'project') return invoiceBelongsToLink(link.workspaceId, link.targetId, invoiceId);
  return false;
}
