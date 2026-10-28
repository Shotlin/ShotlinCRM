import { asc, eq, isNotNull, and, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { expenses, invoiceItems, invoices, payments } from '../../db/schema';
import { gstModelFromRows } from '../invoicing/model';
import { buildGstReport, fyOf, type ReportDoc } from './report';

const stateName = (placeOfSupply: string) => placeOfSupply.replace(/\s*\(\d+\)\s*$/, '').trim() || placeOfSupply;

export async function loadGstReport(workspaceId: string, fy?: string) {
  const [rows, items, paid, spend] = await Promise.all([
    db.select().from(invoices).where(and(eq(invoices.workspaceId, workspaceId), isNotNull(invoices.docType))),
    db
      .select({ item: invoiceItems })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
      .where(and(eq(invoices.workspaceId, workspaceId), isNotNull(invoices.docType)))
      .orderBy(asc(invoiceItems.position)),
    db
      .select({ invoiceId: payments.invoiceId, total: sql<number>`sum(${payments.amountMinor})::bigint`, last: sql<Date>`max(${payments.receivedAt})` })
      .from(payments)
      .where(eq(payments.workspaceId, workspaceId))
      .groupBy(payments.invoiceId),
    db.select({ spentAt: expenses.spentAt, gstMinor: expenses.gstMinor, itcEligible: expenses.itcEligible }).from(expenses).where(eq(expenses.workspaceId, workspaceId)),
  ]);

  const docs: ReportDoc[] = [];
  for (const row of rows) {
    const mine = items.filter((entry) => entry.item.invoiceId === row.id).map((entry) => entry.item);
    const payment = paid.find((p) => p.invoiceId === row.id);
    const received = Number(payment?.total ?? 0);
    const built = gstModelFromRows(row, mine, received);
    if (!built) continue;
    const { model, totals } = built;
    docs.push({
      docNo: row.number,
      docType: model.docType,
      status: row.status,
      cancelled: built.cancelled,
      issuedAt: row.issuedAt,
      client: model.customer.name,
      gstin: model.customer.gstin?.trim() || null,
      stateName: stateName(model.customer.placeOfSupply),
      stateCode: model.customer.stateCode,
      project: model.project.name,
      taxRatePct: model.taxRatePct,
      taxableMinor: totals.billableMinor,
      cgstMinor: totals.cgstMinor,
      sgstMinor: totals.sgstMinor,
      igstMinor: totals.igstMinor,
      taxMinor: totals.taxMinor,
      grandMinor: totals.grandMinor,
      receivedMinor: received,
      lastPaidAt: payment?.last ? new Date(payment.last) : null,
      advanceTaxableMinor: model.advanceTaxableMinor ?? 0,
      advanceRef: model.project.advanceRef ?? null,
    });
  }
  const years = [...new Set(docs.map((d) => d.docNo.split('/')[2]))].sort().reverse();
  const current = fyOf(new Date());
  const chosen = fy && /^\d{2}-\d{2}$/.test(fy) ? fy : years[0] ?? current;
  const report = buildGstReport(
    docs,
    spend.map((e) => ({ date: e.spentAt, gstMinor: e.gstMinor, itcEligible: e.itcEligible })),
    chosen,
  );
  return { report, years: years.length ? years : [current] };
}
