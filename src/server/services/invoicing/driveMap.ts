// Turns an invoice into the exact cells of the master workbook. Pure functions: no network,
// no database, so every rule here can be tested on its own.
import {
  fyLabel,
  istDateIso,
  monthLabel,
  quarterLabel,
  supplyTypeLabel,
  type GstInvoice,
  type Totals,
} from './calc';

export type RowRequest = {
  values: Record<string, unknown>;
  links?: Record<string, { text: string; url: string }>;
  appendNotes?: Record<string, string>;
  overwrite?: string[];
};

type Context = {
  model: GstInvoice;
  totals: Totals;
  docNo: string;
  receivedMinor: number;
  cancelled: boolean;
  cancelReason?: string | null;
  pdf?: { name: string; url: string };
};

const rupees = (minor: number) => minor / 100;
const date = (value: Date) => ({ date: istDateIso(value) });

const TYPE_LABEL = { final: 'Final Invoice', advance: 'Advance Invoice', regular: 'Regular Invoice' } as const;
const MODE_LABEL: Record<string, string> = {
  bank: 'Bank transfer',
  upi: 'UPI',
  card: 'Card',
  cash: 'Cash',
  other: 'Other',
};

const place = ({ model }: Context) => `${model.customer.placeOfSupply} (${model.customer.stateCode})`;

// One row of GST_Series. A cancelled invoice keeps its row, so the number sequence stays unbroken,
// but its money is zeroed so it drops out of every quarter total.
export function seriesRow(context: Context): RowRequest {
  const { model, totals, cancelled } = context;
  const zero = (minor: number) => (cancelled ? 0 : rupees(minor));
  const grand = totals.grandMinor;
  const row: RowRequest = {
    values: {
      A: fyLabel(model.issuedAt),
      B: quarterLabel(model.issuedAt),
      C: monthLabel(model.issuedAt),
      D: model.series,
      E: model.serial,
      F: context.docNo,
      G: date(model.issuedAt),
      H: TYPE_LABEL[model.docType],
      I: model.customer.name,
      J: model.project.name,
      K: place(context),
      L: model.customer.gstin ?? 'Unregistered',
      M: model.sac,
      N: supplyTypeLabel(model).replace(/ \(.*\)$/, ''),
      O: model.supplyType === 'intra' ? 'CGST + SGST' : 'IGST',
      P: model.taxRatePct / 100,
      Q: zero(totals.billableMinor),
      R: zero(totals.cgstMinor),
      S: zero(totals.sgstMinor),
      T: zero(totals.igstMinor),
      V: zero(totals.roundOffMinor),
      W: zero(grand),
      X: cancelled ? 0 : rupees(Math.min(context.receivedMinor, grand)),
      Y: cancelled ? 0 : rupees(Math.max(0, grand - context.receivedMinor)),
      Z: model.paymentStatus,
      // Filing status and notes are kept by hand, so they are only filled in on a brand new row.
      AA: 'Current Quarter / Not Filed',
      AB: `${quarterLabel(model.issuedAt)} ${fyLabel(model.issuedAt)}`,
      AC: context.pdf?.name ?? '',
      AD: '',
    },
    links: context.pdf ? { AC: { text: context.pdf.name, url: context.pdf.url } } : undefined,
  };
  if (cancelled) {
    const was = `was taxable Rs. ${rupees(totals.billableMinor).toFixed(2)}, total Rs. ${rupees(grand).toFixed(2)}`;
    row.appendNotes = { AD: `CANCELLED: ${context.cancelReason ?? 'no reason given'} (${was})` };
  }
  return row;
}

// A reserved row in GST_Pending: a draft, or an advance still waiting for its payment.
export function pendingRow(context: Context): RowRequest {
  const { model, totals } = context;
  return {
    values: {
      A: fyLabel(model.issuedAt),
      B: quarterLabel(model.issuedAt),
      C: monthLabel(model.issuedAt),
      D: model.series,
      E: model.serial,
      F: context.docNo,
      G: date(model.issuedAt),
      H: TYPE_LABEL[model.docType],
      I: model.customer.name,
      J: model.project.name,
      K: place(context),
      L: model.customer.gstin ?? 'Unregistered',
      M: rupees(totals.billableMinor),
      N: totals.taxRateLabel,
      O: rupees(totals.taxMinor),
      P: rupees(totals.grandMinor),
      Q: model.paymentStatus,
      R: 'Reserved / Pending',
      T: '',
    },
    links: context.pdf ? { S: { text: 'Open draft PDF', url: context.pdf.url } } : undefined,
  };
}

// When an invoice leaves Pending, its Pending row stays as a record but stops counting as reserved.
export function pendingPromotion(context: Context): RowRequest {
  return {
    values: {
      Q: context.model.paymentStatus,
      R: context.cancelled ? 'Cancelled (see GST_Series)' : 'Promoted / Paid',
    },
    links: context.pdf ? { S: { text: 'Open issued PDF', url: context.pdf.url } } : undefined,
  };
}

export type PaymentInput = { id: string; amountMinor: number; receivedAt: Date; method: string; note: string };

// One Pay_Ledger line per payment, keyed by the payment's id so it is only ever written once.
export function ledgerRow(context: Context, payment: PaymentInput): RowRequest {
  const { model, totals } = context;
  const grand = totals.grandMinor;
  const taxableBase = grand > 0 ? Math.round((payment.amountMinor * totals.billableMinor) / grand) : 0;
  const type =
    model.docType === 'advance' ? 'Advance / milestone' : payment.amountMinor >= grand ? 'Full payment' : 'Part payment';
  return {
    values: {
      A: date(payment.receivedAt),
      B: model.customer.name,
      C: model.project.name,
      D: context.docNo,
      E: type,
      F: rupees(taxableBase),
      G: rupees(payment.amountMinor - taxableBase),
      H: rupees(payment.amountMinor),
      I: MODE_LABEL[payment.method] ?? 'Other',
      J: model.paymentStatus,
      K: quarterLabel(payment.receivedAt),
      L: payment.note,
      M: context.pdf?.name ?? '',
      N: payment.id,
    },
  };
}

// Where the invoice's files and register row belong right now.
export function chooseDestination(input: {
  status: string;
  docType: GstInvoice['docType'];
  cancelled: boolean;
  receivedMinor: number;
  grandMinor: number;
  advanceRule?: string;
}): 'pending' | 'quarter' {
  // A cancelled invoice is filed under its own quarter, marked CANCELLED, so every number is visible.
  if (input.cancelled) return 'quarter';
  if (input.status === 'draft') return 'pending';
  const waitsForPayment =
    input.docType === 'advance' && (input.advanceRule ?? 'pending_until_paid') === 'pending_until_paid';
  if (waitsForPayment && input.receivedMinor < input.grandMinor) return 'pending';
  return 'quarter';
}
