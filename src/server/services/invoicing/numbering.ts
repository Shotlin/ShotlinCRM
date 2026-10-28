import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client';
import { clients, invoiceItems, invoiceSeries, invoices } from '../../db/schema';
import { financialYear } from './calc';
import { gstModelFromRows } from './model';

export type NumberingState = {
  fy: string;
  nextAdvance: string;
  nextInvoice: string;
  // Advance payment requests that are still waiting for their money, oldest first.
  waiting: { id: string; ref: string; client: string; project: string; grossMinor: number; sent: boolean }[];
};

const pad = (fy: string, series: string, serial: number) => `SL/${series}/${fy}/${serial}`;

// What the next numbers will be, read without using them up.
export async function loadNumberingState(workspaceId: string, now = new Date()): Promise<NumberingState> {
  const fy = financialYear(now).label;
  const counters = await db
    .select()
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.workspaceId, workspaceId), eq(invoiceSeries.fy, fy)));
  const next = (series: string) => counters.find((row) => row.series === series)?.nextSerial ?? 1;

  const requests = await db
    .select({ invoice: invoices, client: clients.name })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.docType, 'advance'), eq(invoices.series, 'REF'), isNull(invoices.cancelledAt)))
    .orderBy(asc(invoices.createdAt));
  const waiting: NumberingState['waiting'] = [];
  for (const { invoice, client } of requests) {
    const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
    const built = gstModelFromRows(invoice, items, 0);
    waiting.push({
      id: invoice.id,
      ref: invoice.number,
      client,
      project: invoice.project?.name ?? '',
      grossMinor: built?.totals.grandMinor ?? 0,
      sent: invoice.status !== 'draft',
    });
  }
  return { fy, nextAdvance: pad(fy, 'ADV', next('ADV')), nextInvoice: pad(fy, 'INV', next('INV')), waiting };
}
