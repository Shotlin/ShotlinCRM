import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../../db/client';
import { clients, invoiceItems, invoiceSeries, invoices, leads, payments } from '../../db/schema';
import {
  defaultGstTreatment,
  documentNumber,
  financialYear,
  type DocType,
  type GstInvoice,
} from './calc';
import { markDriveDirty } from './driveState';
import { gstModelFromRows } from './model';
import { SUPPLIER, DEFAULT_JURISDICTION_TERM } from './supplier';
import { deriveSupplyType, type GstInvoiceInput } from './validate';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DAY = 86_400_000;

const seriesFor = (docType: DocType) => (docType === 'advance' ? 'ADV' : 'INV');

const defaultPaymentTerms = (docType: DocType) =>
  docType === 'advance'
    ? 'Advance received / due before project kickoff'
    : 'Due before final delivery / handover';

// The next serial comes from the counter, in one atomic statement that locks the row until
// commit, so two invoices created at the same moment can never receive the same number.
// A series with no counter is refused: the starting number must be set on purpose (after
// importing the existing register, or at a financial-year rollover), never guessed.
export async function allocateSerial(tx: Tx, workspaceId: string, series: 'INV' | 'ADV', fy: string) {
  const configured = Number(process.env.INVOICE_FIRST_SERIAL);
  if (Number.isInteger(configured) && configured > 0) {
    const [row] = await tx
      .insert(invoiceSeries)
      .values({ workspaceId, series, fy, nextSerial: configured + 1 })
      .onConflictDoUpdate({
        target: [invoiceSeries.workspaceId, invoiceSeries.series, invoiceSeries.fy],
        set: { nextSerial: sql`${invoiceSeries.nextSerial} + 1` },
      })
      .returning({ nextSerial: invoiceSeries.nextSerial });
    return row.nextSerial - 1;
  }
  const [row] = await tx
    .update(invoiceSeries)
    .set({ nextSerial: sql`${invoiceSeries.nextSerial} + 1` })
    .where(
      and(eq(invoiceSeries.workspaceId, workspaceId), eq(invoiceSeries.series, series), eq(invoiceSeries.fy, fy)),
    )
    .returning({ nextSerial: invoiceSeries.nextSerial });
  if (!row) {
    throw new Error(
      `The ${series} number series for ${fy} has not been set up yet. Import your existing register or set the starting number first.`,
    );
  }
  return row.nextSerial - 1;
}

async function assertClientAndLead(tx: Tx, workspaceId: string, clientId: string, leadId?: string) {
  const [client] = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.workspaceId, workspaceId)))
    .limit(1);
  if (!client) throw new Error('Client not found in this workspace');
  if (leadId) {
    const [lead] = await tx
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId)))
      .limit(1);
    if (!lead) throw new Error('Lead not found in this workspace');
  }
}

function fieldsFromInput(input: GstInvoiceInput) {
  const supplyType = deriveSupplyType(input.customer.stateCode);
  return {
    docType: input.docType,
    supplyType,
    taxRatePct: input.taxRatePct,
    sac: input.sac,
    paymentTerms: input.paymentTerms?.trim() || defaultPaymentTerms(input.docType),
    customer: input.customer,
    project: input.project,
    projectTaxableMinor: input.docType === 'regular' ? null : (input.projectTaxableMinor ?? null),
    advanceTaxableMinor: input.docType === 'regular' ? null : (input.advanceTaxableMinor ?? null),
    gstTreatment:
      input.gstTreatment?.trim() ||
      defaultGstTreatment(supplyType, input.customer.placeOfSupply, input.taxRatePct),
    adjustmentNote: input.adjustmentNote?.trim() ?? '',
    terms: input.terms?.length ? input.terms : [DEFAULT_JURISDICTION_TERM],
    issuedAt: input.issuedAt,
    dueAt: input.dueAt ?? new Date(input.issuedAt.getTime() + 7 * DAY),
  };
}

const itemRows = (invoiceId: string, input: GstInvoiceInput) =>
  input.lines.map((line, position) => ({
    id: `invoice-item-${randomUUID()}`,
    invoiceId,
    description: line.description,
    detail: line.detail ?? '',
    quantity: line.qty,
    unitPriceMinor: line.unitPriceMinor,
    position,
  }));

// Brings an invoice that was already issued before the CRM into the register, keeping its original number.
// The counter is moved past it so new invoices carry on from the right place. Safe to run again.
export async function importLegacyGstInvoice(
  workspaceId: string,
  input: GstInvoiceInput,
  options: { serial: number; status: 'draft' | 'sent' | 'paid'; expectedDocNo: string },
) {
  return db.transaction(async (tx) => {
    await assertClientAndLead(tx, workspaceId, input.clientId, input.leadId);
    const series = seriesFor(input.docType);
    const fy = financialYear(input.issuedAt).label;
    const docNo = documentNumber({ series, serial: options.serial, issuedAt: input.issuedAt });
    if (docNo !== options.expectedDocNo) throw new Error(`Number mismatch: built ${docNo}, register says ${options.expectedDocNo}`);
    const [existing] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.number, docNo)))
      .limit(1);
    if (existing) return { id: existing.id, docNo, created: false };
    const id = `invoice-${randomUUID()}`;
    await tx.insert(invoices).values({
      id,
      workspaceId,
      number: docNo,
      clientId: input.clientId,
      leadId: null,
      status: options.status,
      currency: 'INR',
      series,
      fy,
      serial: options.serial,
      ...fieldsFromInput(input),
    });
    await tx.insert(invoiceItems).values(itemRows(id, input));
    await tx
      .insert(invoiceSeries)
      .values({ workspaceId, series, fy, nextSerial: options.serial + 1 })
      .onConflictDoUpdate({
        target: [invoiceSeries.workspaceId, invoiceSeries.series, invoiceSeries.fy],
        set: { nextSerial: sql`greatest(${invoiceSeries.nextSerial}, ${options.serial + 1})` },
      });
    return { id, docNo, created: true };
  });
}

export async function createGstInvoice(workspaceId: string, input: GstInvoiceInput) {
  const created = await db.transaction(async (tx) => {
    await assertClientAndLead(tx, workspaceId, input.clientId, input.leadId);
    const series = seriesFor(input.docType);
    const fy = financialYear(input.issuedAt).label;
    const serial = await allocateSerial(tx, workspaceId, series, fy);
    const docNo = documentNumber({ series, serial, issuedAt: input.issuedAt });
    const id = `invoice-${randomUUID()}`;
    const fields = fieldsFromInput(input);

    await tx.insert(invoices).values({
      id,
      workspaceId,
      number: docNo,
      clientId: input.clientId,
      leadId: input.leadId ?? null,
      status: 'draft',
      currency: 'INR',
      series,
      fy,
      serial,
      ...fields,
    });
    await tx.insert(invoiceItems).values(itemRows(id, input));
    return { id, docNo, serial, series, fy };
  });
  await markDriveDirty(workspaceId, created.id);
  return created;
}

// The number, series and financial year are fixed once allocated. A date that would move
// the invoice into another financial year is refused instead of renumbering it.
export async function updateGstInvoice(workspaceId: string, invoiceId: string, input: GstInvoiceInput) {
  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.workspaceId, workspaceId)))
      .for('update')
      .limit(1);
    if (!existing || !existing.docType) throw new Error('GST invoice not found');
    if (existing.cancelledAt) throw new Error('A cancelled invoice cannot be edited');
    if (existing.status !== 'draft') {
      throw new Error('An issued invoice cannot be edited. Cancel it and issue a new one instead.');
    }
    if (existing.docType !== input.docType) throw new Error('The invoice type cannot be changed after the number is issued');
    if (financialYear(input.issuedAt).label !== existing.fy) {
      throw new Error('The date would move this invoice to another financial year');
    }
    await assertClientAndLead(tx, workspaceId, input.clientId, input.leadId);

    const fields = fieldsFromInput(input);
    await tx
      .update(invoices)
      .set({
        clientId: input.clientId,
        leadId: input.leadId ?? null,
        ...fields,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId));
    await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
    await tx.insert(invoiceItems).values(itemRows(invoiceId, input));
    return { id: invoiceId, docNo: existing.number };
  });
  await markDriveDirty(workspaceId, invoiceId);
  return updated;
}

// Issuing locks the invoice: from here it can be paid or cancelled, but not rewritten.
export async function issueGstInvoice(workspaceId: string, invoiceId: string) {
  const [updated] = await db
    .update(invoices)
    .set({ status: 'sent', updatedAt: new Date() })
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.workspaceId, workspaceId),
        eq(invoices.status, 'draft'),
        isNotNull(invoices.docType),
        isNull(invoices.cancelledAt),
      ),
    )
    .returning({ id: invoices.id, number: invoices.number });
  if (updated) {
    await markDriveDirty(workspaceId, invoiceId);
    return { id: updated.id, docNo: updated.number, alreadyIssued: false };
  }
  const [existing] = await db
    .select({ id: invoices.id, number: invoices.number, status: invoices.status, cancelledAt: invoices.cancelledAt })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.workspaceId, workspaceId), isNotNull(invoices.docType)))
    .limit(1);
  if (!existing) throw new Error('GST invoice not found');
  if (existing.cancelledAt) throw new Error('A cancelled invoice cannot be issued');
  return { id: existing.id, docNo: existing.number, alreadyIssued: true };
}

export async function cancelGstInvoice(workspaceId: string, invoiceId: string, reason: string) {
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.workspaceId, workspaceId)))
      .for('update')
      .limit(1);
    if (!existing || !existing.docType) throw new Error('GST invoice not found');
    if (existing.cancelledAt) return { id: invoiceId, docNo: existing.number, alreadyCancelled: true };
    const [paid] = await tx
      .select({ total: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::bigint` })
      .from(payments)
      .where(eq(payments.invoiceId, invoiceId));
    if (Number(paid?.total ?? 0) > 0) {
      throw new Error('Payments are recorded against this invoice. Reverse them or issue a credit note first.');
    }
    await tx
      .update(invoices)
      .set({ cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));
    return { id: invoiceId, docNo: existing.number, alreadyCancelled: false };
  });
  if (!result.alreadyCancelled) await markDriveDirty(workspaceId, invoiceId);
  return result;
}

export async function loadGstInvoice(workspaceId: string, invoiceId: string) {
  const [row] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw new Error('GST invoice not found');
  const [items, paid] = await Promise.all([
    db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId)).orderBy(asc(invoiceItems.position)),
    db
      .select({ total: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::bigint` })
      .from(payments)
      .where(eq(payments.invoiceId, invoiceId)),
  ]);
  const receivedMinor = Number(paid[0]?.total ?? 0);
  const built = gstModelFromRows(row, items, receivedMinor);
  if (!built) throw new Error('GST invoice not found');
  return {
    model: built.model,
    docNo: row.number,
    clientId: row.clientId,
    status: row.status,
    drive: row.driveFiles,
    cancelled: built.cancelled,
    totals: built.totals,
    receivedMinor,
  };
}

// File name for downloads and for Drive, in the style of your existing files.
export function invoiceFileName(model: GstInvoice, extension: 'pdf' | 'docx') {
  const word = model.docType === 'advance' ? 'Advance' : model.docType === 'final' ? 'Final' : 'Regular';
  // "M/s DM Mobile Shop (Brand: DEALKR)" is filed under its brand, not under "M".
  const brand = model.customer.name.match(/\(Brand:\s*([^)]+)\)/i)?.[1]?.trim();
  const who = (brand ?? model.customer.name)
    .replace(/\b(pvt|private|ltd|limited|llp|and|enterprise|the)\b\.?/gi, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)[0] || 'Client';
  const number = documentNumber(model).replace(/\//g, '-');
  return `${SUPPLIER.brand.charAt(0)}${SUPPLIER.brand.slice(1).toLowerCase()}_${who}_${word}_Invoice_${number}.${extension}`;
}
