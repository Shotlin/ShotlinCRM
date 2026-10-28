import {
  amountInWords,
  computeTotals,
  documentHeading,
  documentNumber,
  formatLongDate,
  formatMoney,
  supplyTypeLabel,
  type GstInvoice,
} from './calc';
import { REVERSE_CHARGE_TEXT, STANDARD_CATEGORY, SUPPLIER } from './supplier';

export type LabelledLine = { label?: string; value: string };

// Everything a renderer needs, already formatted. PDF and Word both draw from this,
// so the two files can never disagree.
export type InvoiceDocument = {
  docNo: string;
  heading: ReturnType<typeof documentHeading>;
  supplierLines: string[];
  meta: { labels: string[]; values: string[] };
  billed: LabelledLine[];
  project: LabelledLine[];
  items: { index: string; description: string; detail?: string; qty: string; taxable: string; rate: string; tax: string; amount: string }[];
  leftNotes: { label?: string; text: string }[];
  totals: { label: string; value: string; grand: boolean }[];
  terms: string[];
  footerLeft: string;
  footerRight: string;
};

export function buildInvoiceDocument(invoice: GstInvoice): InvoiceDocument {
  const totals = computeTotals(invoice);
  const heading = documentHeading(invoice.docType);
  const docNo = documentNumber(invoice);
  const { customer, project } = invoice;

  const billed: LabelledLine[] = [
    { label: 'Customer / Business Name:', value: customer.name },
    ...(customer.representative ? [{ label: 'Authorised Representative:', value: customer.representative }] : []),
    { label: 'Billing Address:', value: customer.address },
    { label: 'City / State / PIN:', value: customer.cityStatePin },
    ...(customer.pan ? [{ label: 'PAN:', value: customer.pan }] : []),
    customer.gstin
      ? { label: 'GSTIN:', value: customer.gstin }
      : { label: 'GST Registration Status:', value: 'Unregistered' },
    { label: 'Place of Supply:', value: `${customer.placeOfSupply} (State Code: ${customer.stateCode})` },
  ];

  const projectLines: LabelledLine[] = [
    { label: 'Project / Service Name:', value: project.name },
    { label: 'Service Category:', value: project.category ?? STANDARD_CATEGORY },
    ...(project.reference ? [{ label: 'Reference:', value: project.reference }] : []),
    ...(invoice.docType === 'final' && project.advanceRef
      ? [{ label: 'Advance Ref:', value: project.advanceRef }]
      : []),
    ...(invoice.docType === 'advance' && project.advanceNote
      ? [{ label: 'Advance:', value: project.advanceNote }]
      : []),
    { label: 'Issue City:', value: SUPPLIER.issueCity },
    { label: 'Reverse Charge:', value: REVERSE_CHARGE_TEXT },
  ];

  const lineCount = invoice.lines.length;
  const perLineTaxShare = (taxable: number) =>
    lineCount === 1 ? totals.taxMinor : Math.round((taxable * invoice.taxRatePct) / 100);
  const items = invoice.lines.map((line, index) => {
    const tax = perLineTaxShare(line.taxableMinor);
    return {
      index: String(index + 1).padStart(2, '0'),
      description: line.description,
      detail: line.detail,
      qty: String(line.qty),
      taxable: formatMoney(line.taxableMinor),
      rate: totals.taxRateLabel,
      tax: formatMoney(tax),
      // The grand total carries the rupee round-off, so a single line shows the unrounded value.
      amount: formatMoney(line.taxableMinor + tax),
    };
  });

  const leftNotes: InvoiceDocument['leftNotes'] = [
    { label: 'Amount in Words:', text: amountInWords(totals.grandMinor) },
    { label: 'GST Treatment:', text: invoice.gstTreatment },
  ];
  if (invoice.adjustmentNote) {
    leftNotes.push({
      label: invoice.docType === 'advance' ? 'Usage Note:' : 'Advance Adjustment Note:',
      text: invoice.adjustmentNote,
    });
  }

  return {
    docNo,
    heading,
    supplierLines: [
      ...SUPPLIER.addressLines,
      `Phone: ${SUPPLIER.phone} | E-mail: ${SUPPLIER.email} | Website: ${SUPPLIER.website}`,
      `Supplier GSTIN: ${SUPPLIER.gstin} | State: ${SUPPLIER.state} (${SUPPLIER.stateCode})`,
    ],
    meta: {
      labels: [heading.dateLabel, 'SAC Code', 'Supply Type', 'Payment Terms', 'Payment Status'],
      values: [
        formatLongDate(invoice.issuedAt),
        invoice.sac,
        supplyTypeLabel(invoice),
        invoice.paymentTerms,
        invoice.paymentStatus,
      ],
    },
    billed,
    project: projectLines,
    items,
    leftNotes,
    totals: totals.rows.map((row) => ({
      label: row.label,
      value: formatMoney(row.valueMinor),
      grand: row.kind === 'grand',
    })),
    terms: invoice.terms,
    footerLeft: SUPPLIER.footerLine,
    footerRight: `${heading.numberLabel}: ${docNo} | Original for Recipient | ${heading.footerKind}`,
  };
}
