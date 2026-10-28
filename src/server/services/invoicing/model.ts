import type { invoiceItems, invoices } from '../../db/schema';
import { computeTotals, derivePaymentStatus, type DocType, type GstInvoice } from './calc';
import { deriveSupplyType } from './validate';

type InvoiceRow = typeof invoices.$inferSelect;
type ItemRow = typeof invoiceItems.$inferSelect;

// Builds the document model from stored rows. Returns null for a plain (non-GST) invoice.
export function gstModelFromRows(row: InvoiceRow, items: ItemRow[], receivedMinor: number) {
  if (!row.docType || !row.series || row.serial === null || !row.customer || !row.project) return null;

  const model: GstInvoice = {
    docType: row.docType as DocType,
    series: row.series as 'INV' | 'ADV' | 'REF',
    serial: row.serial,
    issuedAt: row.issuedAt,
    sac: row.sac,
    supplyType: (row.supplyType as GstInvoice['supplyType']) ?? deriveSupplyType(row.customer.stateCode),
    taxRatePct: row.taxRatePct,
    paymentTerms: row.paymentTerms,
    paymentStatus: '',
    customer: row.customer,
    project: row.project,
    lines: [...items]
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        description: item.description,
        detail: item.detail || undefined,
        qty: item.quantity,
        taxableMinor: item.quantity * item.unitPriceMinor,
      })),
    projectTaxableMinor: row.projectTaxableMinor ?? undefined,
    advanceTaxableMinor: row.advanceTaxableMinor ?? undefined,
    gstTreatment: row.gstTreatment,
    adjustmentNote: row.adjustmentNote || undefined,
    terms: row.terms,
  };
  const totals = computeTotals(model);
  model.paymentStatus = derivePaymentStatus(model.docType, totals.grandMinor, receivedMinor, row.cancelledAt !== null);
  return { model, totals, cancelled: row.cancelledAt !== null };
}
