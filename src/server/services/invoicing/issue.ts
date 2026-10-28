import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../../db/client';
import { clients, invoiceItems, invoiceRevisions, invoiceSeries, invoices, leads, payments } from '../../db/schema';
import {
  defaultGstTreatment,
  documentNumber,
  financialYear,
  formatMoney,
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
    // A new financial year starts again at 1, but only when an earlier year already exists, so a series is never guessed from nothing.
    const [earlier] = await tx
      .select({ fy: invoiceSeries.fy })
      .from(invoiceSeries)
      .where(and(eq(invoiceSeries.workspaceId, workspaceId), eq(invoiceSeries.series, series)))
      .limit(1);
    if (!earlier) {
      throw new Error(
        `The ${series} number series for ${fy} has not been set up yet. Import your existing register or set the starting number first.`,
      );
    }
    await tx.insert(invoiceSeries).values({ workspaceId, series, fy, nextSerial: 2 }).onConflictDoNothing();
    return 1;
  }
  return row.nextSerial - 1;
}

// Drafts and advance payment requests carry a reference (SL/REF/26-27/7), not a tax number.
// Their own counter starts at 1 in every financial year, so nothing has to be set up first.
export async function allocateReference(tx: Tx, workspaceId: string, fy: string) {
  const [row] = await tx
    .insert(invoiceSeries)
    .values({ workspaceId, series: 'REF', fy, nextSerial: 2 })
    .onConflictDoUpdate({
      target: [invoiceSeries.workspaceId, invoiceSeries.series, invoiceSeries.fy],
      set: { nextSerial: sql`${invoiceSeries.nextSerial} + 1` },
    })
    .returning({ nextSerial: invoiceSeries.nextSerial });
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
    // The real INV / ADV number is given later: an invoice gets INV when issued, an advance gets ADV when it is paid.
    const series = 'REF' as const;
    const fy = financialYear(input.issuedAt).label;
    const serial = await allocateReference(tx, workspaceId, fy);
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
// A draft can be edited freely. An issued invoice can only be amended: the reason is required, what it said
// before is kept as a revision, and it can never be made smaller than what has already been received.
export async function updateGstInvoice(
  workspaceId: string,
  invoiceId: string,
  input: GstInvoiceInput,
  options: { amend?: boolean; reason?: string } = {},
) {
  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.workspaceId, workspaceId)))
      .for('update')
      .limit(1);
    if (!existing || !existing.docType) throw new Error('GST invoice not found');
    if (existing.cancelledAt) throw new Error('A cancelled invoice cannot be edited');
    const issued = existing.status !== 'draft';
    const reason = options.reason?.trim() ?? '';
    if (issued) {
      if (!options.amend) throw new Error('This invoice is already issued. Press "Edit this invoice" to amend it.');
      if (reason.length < 3) throw new Error('Give a short reason for the change');
    }
    if (existing.docType !== input.docType) throw new Error('The invoice type cannot be changed after the number is issued');
    if (financialYear(input.issuedAt).label !== existing.fy) {
      throw new Error('The date would move this invoice to another financial year');
    }
    await assertClientAndLead(tx, workspaceId, input.clientId, input.leadId);

    let revision: number | null = null;
    let received = 0;
    if (issued) {
      const oldItems = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
      const [paid] = await tx.select({ total: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::bigint` }).from(payments).where(eq(payments.invoiceId, invoiceId));
      received = Number(paid?.total ?? 0);
      const previous = gstModelFromRows(existing, oldItems, received);
      const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(invoiceRevisions).where(eq(invoiceRevisions.invoiceId, invoiceId));
      revision = (count?.n ?? 0) + 1;
      await tx.insert(invoiceRevisions).values({
        id: `revision-${randomUUID()}`,
        workspaceId,
        invoiceId,
        revision,
        reason,
        previousNumber: existing.number,
        previousGrandMinor: previous?.totals.grandMinor ?? 0,
        snapshot: JSON.parse(JSON.stringify({ invoice: existing, items: oldItems })),
      });
    }

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

    if (issued) {
      const [row] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      const newItems = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
      const next = gstModelFromRows(row, newItems, received);
      const newGrand = next?.totals.grandMinor ?? 0;
      if (received > newGrand) {
        throw new Error(`The new total is less than the ${formatMoney(received)} already received. Reverse the payment first.`);
      }
      // If more is now due, it is no longer "paid".
      if (existing.status === 'paid' && received < newGrand) {
        await tx.update(invoices).set({ status: 'sent' }).where(eq(invoices.id, invoiceId));
      }
    }
    return { id: invoiceId, docNo: existing.number, revision };
  });
  await markDriveDirty(workspaceId, invoiceId);
  return updated;
}

// Issuing locks the invoice: from here it can be paid or cancelled, but not rewritten.
// A tax invoice takes the next INV number now. An advance is only a payment request until it is paid,
// so it keeps its reference and takes the next ADV number at the moment the full advance arrives.
export async function issueGstInvoice(workspaceId: string, invoiceId: string) {
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.workspaceId, workspaceId), isNotNull(invoices.docType)))
      .for('update')
      .limit(1);
    if (!existing) throw new Error('GST invoice not found');
    if (existing.cancelledAt) throw new Error('A cancelled invoice cannot be issued');
    if (existing.status !== 'draft') return { id: existing.id, docNo: existing.number, alreadyIssued: true };

    let number = existing.number;
    let serial = existing.serial;
    let series = existing.series;
    if (existing.docType !== 'advance' && existing.series === 'REF') {
      series = 'INV';
      serial = await allocateSerial(tx, workspaceId, 'INV', existing.fy ?? financialYear(existing.issuedAt).label);
      number = documentNumber({ series: 'INV', serial, issuedAt: existing.issuedAt });
    }
    await tx.update(invoices).set({ status: 'sent', number, series, serial, updatedAt: new Date() }).where(eq(invoices.id, invoiceId));
    return { id: existing.id, docNo: number, alreadyIssued: false };
  });
  if (!result.alreadyIssued) await markDriveDirty(workspaceId, invoiceId);
  return result;
}

// Called inside the payment transaction. The first full payment of an advance request gives it the next ADV number,
// dated the day the money arrived, so numbers follow the order in which advances are actually received.
export async function promoteAdvanceIfPaid(
  tx: Tx,
  workspaceId: string,
  invoice: typeof invoices.$inferSelect,
  fullyPaid: boolean,
  paidAt: Date,
) {
  if (!fullyPaid || invoice.series !== 'REF' || invoice.docType !== 'advance') return null;
  const fy = financialYear(paidAt).label;
  const serial = await allocateSerial(tx, workspaceId, 'ADV', fy);
  const number = documentNumber({ series: 'ADV', serial, issuedAt: paidAt });
  await tx
    .update(invoices)
    .set({ series: 'ADV', serial, fy, number, issuedAt: paidAt, status: 'paid', updatedAt: new Date() })
    .where(eq(invoices.id, invoice.id));
  return { number, wasReference: invoice.number };
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
