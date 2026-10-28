// GST invoice maths. All money is integer paise so totals never drift.
import { SUPPLIER } from './supplier';

export type SupplyType = 'intra' | 'inter';
export type DocType = 'final' | 'advance' | 'regular';

export type InvoiceLine = {
  description: string;
  detail?: string;
  qty: number;
  taxableMinor: number;
};

export type GstInvoice = {
  docType: DocType;
  series: 'INV' | 'ADV';
  serial: number;
  issuedAt: Date;
  sac: string;
  supplyType: SupplyType;
  taxRatePct: number;
  paymentTerms: string;
  paymentStatus: string;
  customer: {
    name: string;
    representative?: string;
    address: string;
    cityStatePin: string;
    pan?: string;
    gstin?: string;
    placeOfSupply: string;
    stateCode: string;
  };
  project: {
    name: string;
    category?: string;
    reference?: string;
    // Final invoices point at the advance document; advance invoices describe the milestone.
    advanceRef?: string;
    advanceNote?: string;
  };
  lines: InvoiceLine[];
  projectTaxableMinor?: number;
  advanceTaxableMinor?: number;
  gstTreatment: string;
  adjustmentNote?: string;
  terms: string[];
};

// Tax type follows the state, never a typed choice: same state is CGST + SGST, otherwise IGST.
export const deriveSupplyType = (stateCode: string): SupplyType =>
  stateCode === SUPPLIER.stateCode ? 'intra' : 'inter';

export type TotalRow = { label: string; valueMinor: number; kind?: 'grand' };

export type Totals = {
  billableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  taxMinor: number;
  roundOffMinor: number;
  grandMinor: number;
  rows: TotalRow[];
  taxLabel: string;
  taxRateLabel: string;
};

const fmtIN = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatMoney = (minor: number) => `Rs. ${fmtIN.format(minor / 100)}`;

const trimPct = (value: number) => String(Number(value.toFixed(2)));

export function computeTotals(invoice: GstInvoice): Totals {
  const rate = invoice.taxRatePct;
  const billableMinor = invoice.lines.reduce((sum, line) => sum + line.taxableMinor, 0);
  const intra = invoice.supplyType === 'intra';
  const half = Math.round((billableMinor * (rate / 2)) / 100);
  const cgstMinor = intra ? half : 0;
  const sgstMinor = intra ? half : 0;
  const igstMinor = intra ? 0 : Math.round((billableMinor * rate) / 100);
  const taxMinor = cgstMinor + sgstMinor + igstMinor;
  const raw = billableMinor + taxMinor;
  // Advance receipts are exact; tax invoices round to the nearest rupee.
  const roundsToRupee = invoice.docType !== 'advance';
  const grandMinor = roundsToRupee ? Math.round(raw / 100) * 100 : raw;
  const roundOffMinor = grandMinor - raw;

  const sac = invoice.sac;
  const taxRows: TotalRow[] = intra
    ? [
        { label: `CGST @ ${trimPct(rate / 2)}% (SAC ${sac})`, valueMinor: cgstMinor },
        { label: `SGST @ ${trimPct(rate / 2)}% (SAC ${sac})`, valueMinor: sgstMinor },
      ]
    : [{ label: `IGST @ ${trimPct(rate)}% (SAC ${sac})`, valueMinor: igstMinor }];

  const projectMinor = invoice.projectTaxableMinor;
  const advanceMinor = invoice.advanceTaxableMinor ?? 0;
  const rows: TotalRow[] = [];
  if (invoice.docType === 'regular' || projectMinor === undefined) {
    rows.push({ label: 'Taxable Value', valueMinor: billableMinor });
  } else if (invoice.docType === 'final') {
    rows.push(
      { label: 'Total Project Taxable Value', valueMinor: projectMinor },
      { label: 'Less: Advance Taxable Value', valueMinor: advanceMinor },
      { label: 'Balance Taxable Value', valueMinor: projectMinor - advanceMinor },
    );
  } else {
    rows.push(
      { label: 'Total Project Taxable Value', valueMinor: projectMinor },
      { label: 'Advance Taxable Value', valueMinor: advanceMinor },
      { label: 'Balance Taxable Value', valueMinor: projectMinor - advanceMinor },
    );
  }
  rows.push(...taxRows);
  if (roundsToRupee) rows.push({ label: 'Round Off', valueMinor: roundOffMinor });
  rows.push({
    label: invoice.docType === 'advance' ? 'TOTAL ADVANCE RECEIVED' : 'TOTAL PAYABLE',
    valueMinor: grandMinor,
    kind: 'grand',
  });

  return {
    billableMinor,
    cgstMinor,
    sgstMinor,
    igstMinor,
    taxMinor,
    roundOffMinor,
    grandMinor,
    rows,
    taxLabel: intra ? 'CGST + SGST' : 'IGST',
    taxRateLabel: intra ? `CGST ${trimPct(rate / 2)}% + SGST ${trimPct(rate / 2)}%` : `IGST ${trimPct(rate)}%`,
  };
}

// ---------- Amount in words (Indian system: lakh / crore) ----------

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
  'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below100(n: number): string {
  if (n < 20) return ONES[n];
  const unit = n % 10;
  return unit ? `${TENS[Math.floor(n / 10)]}-${ONES[unit]}` : TENS[Math.floor(n / 10)];
}

function below1000(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : '', rest ? below100(rest) : ''].filter(Boolean).join(' ');
}

function wholeNumberWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1_000);
  const rest = n % 1_000;
  if (crore) parts.push(`${wholeNumberWords(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

export function amountInWords(minor: number): string {
  const rupees = Math.floor(minor / 100);
  const paise = minor % 100;
  const rupeeWords = `${wholeNumberWords(rupees)} Rupees`;
  return paise ? `${rupeeWords} and ${below100(paise)} Paise Only` : `${rupeeWords} Only`;
}

// ---------- Dates, financial year and quarter (India: April to March, IST) ----------

const IST = 'Asia/Kolkata';

function istParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

export function financialYear(date: Date) {
  const { year, month } = istParts(date);
  const start = month >= 4 ? year : year - 1;
  const two = (value: number) => String(value % 100).padStart(2, '0');
  return { label: `${two(start)}-${two(start + 1)}`, startYear: start };
}

export function quarterLabel(date: Date) {
  const { month } = istParts(date);
  if (month >= 4 && month <= 6) return 'Q1 (Apr-Jun)';
  if (month >= 7 && month <= 9) return 'Q2 (Jul-Sep)';
  if (month >= 10 && month <= 12) return 'Q3 (Oct-Dec)';
  return 'Q4 (Jan-Mar)';
}

export const documentNumber = (invoice: Pick<GstInvoice, 'series' | 'serial' | 'issuedAt'>) =>
  `SL/${invoice.series}/${financialYear(invoice.issuedAt).label}/${invoice.serial}`;

export const formatLongDate = (date: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: IST, day: '2-digit', month: 'long', year: 'numeric' }).format(date);

export const supplyTypeLabel = (invoice: Pick<GstInvoice, 'supplyType'>) =>
  invoice.supplyType === 'intra' ? 'Intra-State Service (CGST + SGST)' : 'Inter-State Service (IGST)';

// ---------- Wording that depends on the document type ----------

export function documentHeading(docType: DocType) {
  if (docType === 'advance') {
    return {
      title: 'ADVANCE TAX INVOICE',
      subtitle: 'RECEIPT VOUCHER / ADVANCE PAYMENT',
      numberLabel: 'Document No',
      dateLabel: 'Document Date',
      footerKind: 'Advance Invoice / Receipt Voucher',
    };
  }
  return {
    title: 'TAX INVOICE',
    subtitle: docType === 'final' ? 'FINAL PAYMENT / BALANCE INVOICE' : '',
    numberLabel: 'Invoice No',
    dateLabel: 'Invoice Date',
    footerKind: docType === 'final' ? 'Final / Balance Invoice' : 'Tax Invoice',
  };
}

export function defaultGstTreatment(supplyType: SupplyType, placeOfSupply: string, ratePct: number) {
  return supplyType === 'intra'
    ? `CGST @ ${trimPct(ratePct / 2)}% + SGST @ ${trimPct(ratePct / 2)}% applies because the supplier and the place of supply (${placeOfSupply}) are in the same state.`
    : `IGST @ ${trimPct(ratePct)}% applies because the supplier is in West Bengal and the place of supply is ${placeOfSupply}.`;
}

// "Paid" is never typed in. It is worked out from the payments actually recorded.
export function derivePaymentStatus(docType: DocType, grandMinor: number, receivedMinor: number, cancelled: boolean) {
  if (cancelled) return 'CANCELLED';
  if (docType === 'advance') {
    if (receivedMinor >= grandMinor) return 'PAID / RECEIVED';
    return receivedMinor > 0 ? 'PARTIALLY RECEIVED' : 'PAYMENT PENDING';
  }
  if (receivedMinor >= grandMinor) return 'PAID IN FULL';
  return receivedMinor > 0 ? 'PARTIALLY PAID' : 'PAYABLE / DUE';
}
