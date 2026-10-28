import { describe, expect, it } from 'vitest';
import {
  computeTotals,
  derivePaymentStatus,
  monthLabel,
  quarterFolderName,
  type GstInvoice,
} from './calc';
import { chooseDestination, ledgerRow, pendingPromotion, pendingRow, seriesRow } from './driveMap';
import { createHarness } from './testing/appsScriptHarness';

const base: GstInvoice = {
  docType: 'final',
  series: 'INV',
  serial: 102,
  issuedAt: new Date('2026-07-06T06:00:00Z'),
  sac: '998314',
  supplyType: 'inter',
  taxRatePct: 18,
  paymentTerms: '',
  paymentStatus: 'PAYABLE / DUE',
  customer: {
    name: 'Sample Client',
    address: 'x',
    cityStatePin: 'y',
    gstin: '24AAAAA0000A1Z5',
    placeOfSupply: 'Gujarat',
    stateCode: '24',
  },
  project: { name: 'Sample Project' },
  lines: [{ description: 'Balance', qty: 1, taxableMinor: 1_499_900 }],
  projectTaxableMinor: 2_999_900,
  advanceTaxableMinor: 1_500_000,
  gstTreatment: '',
  terms: [],
};

const context = (overrides: Partial<Parameters<typeof seriesRow>[0]> = {}, model: GstInvoice = base) => ({
  model,
  totals: computeTotals(model),
  docNo: 'SL/INV/26-27/102',
  receivedMinor: 0,
  cancelled: false,
  pdf: { name: 'Shotlin_Sample_Final_Invoice_SL-INV-26-27-102.pdf', url: 'https://drive.google.com/file/d/f1/view' },
  ...overrides,
});

describe('labels', () => {
  it('names quarter folders in Drive the way the existing ones are named', () => {
    expect(quarterFolderName(new Date('2026-05-13T06:00:00Z'))).toBe('Q1 (Apr-Jun 2026)');
    expect(quarterFolderName(new Date('2026-07-06T06:00:00Z'))).toBe('Q2 (Jul-Sep 2026)');
    expect(quarterFolderName(new Date('2026-10-28T06:00:00Z'))).toBe('Q3 (Oct-Dec 2026)');
    // January to March belongs to the previous April's financial year but carries its own calendar year.
    expect(quarterFolderName(new Date('2027-02-10T06:00:00Z'))).toBe('Q4 (Jan-Mar 2027)');
  });

  it('uses Indian time at the quarter boundary', () => {
    // 20:00 UTC on 31 March is already 1 April in India.
    expect(quarterFolderName(new Date('2027-03-31T20:00:00Z'))).toBe('Q1 (Apr-Jun 2027)');
    expect(quarterFolderName(new Date('2027-03-31T10:00:00Z'))).toBe('Q4 (Jan-Mar 2027)');
  });

  it('writes the month the way the register does', () => {
    expect(monthLabel(new Date('2026-05-13T06:00:00Z'))).toBe('May-26');
    expect(monthLabel(new Date('2026-07-06T06:00:00Z'))).toBe('Jul-26');
  });
});

describe('seriesRow', () => {
  it('fills the register columns for an issued invoice', () => {
    const { values, links } = seriesRow(context());
    expect(values).toMatchObject({
      A: 'FY26-27', B: 'Q2 (Jul-Sep)', C: 'Jul-26', D: 'INV', E: 102, F: 'SL/INV/26-27/102',
      G: { date: '2026-07-06' }, H: 'Final Invoice', I: 'Sample Client', K: 'Gujarat (24)',
      L: '24AAAAA0000A1Z5', M: '998314', N: 'Inter-State Service', O: 'IGST', P: 0.18,
      Q: 14999, R: 0, S: 0, T: 2699.82, V: 0.18, W: 17699, X: 0, Y: 17699,
      Z: 'PAYABLE / DUE', AB: 'Q2 (Jul-Sep) FY26-27',
    });
    expect(links?.AC.url).toBe('https://drive.google.com/file/d/f1/view');
  });

  it('never writes the formula columns', () => {
    const { values } = seriesRow(context());
    expect(Object.keys(values)).not.toContain('U');
    expect(Object.keys(values)).not.toContain('AE');
  });

  it('shows received and balance from real payments, capped at the total', () => {
    const half = seriesRow(context({ receivedMinor: 500_000 })).values;
    expect([half.X, half.Y]).toEqual([5000, 12699]);
    const over = seriesRow(context({ receivedMinor: 2_000_000 })).values;
    expect([over.X, over.Y]).toEqual([17699, 0]);
  });

  it('uses CGST and SGST for a same-state customer, and Unregistered when there is no GSTIN', () => {
    const intra: GstInvoice = { ...base, supplyType: 'intra', customer: { ...base.customer, gstin: undefined, stateCode: '19', placeOfSupply: 'West Bengal' } };
    const { values } = seriesRow(context({}, intra));
    expect(values).toMatchObject({ N: 'Intra-State Service', O: 'CGST + SGST', R: 1349.91, S: 1349.91, T: 0, L: 'Unregistered', K: 'West Bengal (19)' });
  });

  it('zeroes a cancelled invoice and notes why, keeping the number', () => {
    const cancelledModel = { ...base, paymentStatus: 'CANCELLED' };
    const row = seriesRow(context({ cancelled: true, cancelReason: 'Issued in error' }, cancelledModel));
    expect(row.values).toMatchObject({ F: 'SL/INV/26-27/102', Q: 0, T: 0, W: 0, X: 0, Y: 0, Z: 'CANCELLED' });
    expect(row.appendNotes?.AD).toBe('CANCELLED: Issued in error (was taxable Rs. 14999.00, total Rs. 17699.00)');
  });
});

describe('pending and ledger rows', () => {
  it('reserves a pending row with the reserved status the number-control tab looks for', () => {
    const { values, links } = pendingRow(context());
    expect(values).toMatchObject({ D: 'INV', E: 102, F: 'SL/INV/26-27/102', M: 14999, N: 'IGST 18%', O: 2699.82, P: 17699, R: 'Reserved / Pending' });
    expect(links?.S.text).toBe('Open draft PDF');
  });

  it('marks a pending row promoted or cancelled', () => {
    expect(pendingPromotion(context()).values.R).toBe('Promoted / Paid');
    expect(pendingPromotion(context({ cancelled: true })).values.R).toBe('Cancelled (see GST_Series)');
  });

  it('splits each payment into taxable base and GST, adding back to the amount received', () => {
    const row = ledgerRow(context(), { id: 'p1', amountMinor: 500_000, receivedAt: new Date('2026-07-10T06:00:00Z'), method: 'upi', note: 'UTR 123' });
    expect(row.values).toMatchObject({ A: { date: '2026-07-10' }, D: 'SL/INV/26-27/102', E: 'Part payment', H: 5000, I: 'UPI', K: 'Q2 (Jul-Sep)', L: 'UTR 123', N: 'p1' });
    const taxable = row.values.F as number;
    const gst = row.values.G as number;
    expect(Math.round((taxable + gst) * 100)).toBe(500_000);
  });

  it('labels the payment type by invoice type and amount', () => {
    const full = ledgerRow(context(), { id: 'p', amountMinor: 1_769_900, receivedAt: base.issuedAt, method: 'bank', note: '' });
    expect(full.values.E).toBe('Full payment');
    const advanceModel: GstInvoice = { ...base, docType: 'advance', series: 'ADV' };
    const advance = ledgerRow(context({}, advanceModel), { id: 'p', amountMinor: 100, receivedAt: base.issuedAt, method: 'bank', note: '' });
    expect(advance.values.E).toBe('Advance / milestone');
  });
});

describe('chooseDestination', () => {
  const ok = { docType: 'final' as const, cancelled: false, receivedMinor: 0, grandMinor: 1000 };
  it('keeps drafts in Pending', () => {
    expect(chooseDestination({ ...ok, status: 'draft' })).toBe('pending');
  });
  it('files an issued final invoice under its quarter, paid or not', () => {
    expect(chooseDestination({ ...ok, status: 'sent' })).toBe('quarter');
  });
  it('holds an unpaid advance in Pending until it is paid, then files it', () => {
    const advance = { ...ok, docType: 'advance' as const, status: 'sent' };
    expect(chooseDestination(advance)).toBe('pending');
    expect(chooseDestination({ ...advance, receivedMinor: 1000 })).toBe('quarter');
  });
  it('can be switched to file advances as soon as they are issued', () => {
    expect(chooseDestination({ ...ok, docType: 'advance', status: 'sent', advanceRule: 'on_issue' })).toBe('quarter');
  });
  it('files a cancelled invoice under its quarter whatever its state', () => {
    expect(chooseDestination({ ...ok, status: 'draft', cancelled: true })).toBe('quarter');
  });
});

describe('end to end through the real script', () => {
  // Adds up the register the way the Qtr_Sum tab does: by financial year and quarter.
  const sum = (h: ReturnType<typeof createHarness>, column: string, quarter: string) => {
    let total = 0;
    for (let row = 7; row <= 506; row++) {
      if (h.series.cell(`B${row}`) === quarter) total += Number(h.series.cell(`${column}${row}`) ?? 0);
    }
    return Math.round(total * 100) / 100;
  };

  const push = (h: ReturnType<typeof createHarness>, request: ReturnType<typeof seriesRow>, sheet: string, key: string) =>
    h.call({ action: 'upsertRow', sheet, key, ...request });

  it('keeps the quarter totals right across issue, payment and cancellation', () => {
    const h = createHarness();
    const a = context();
    const b = context(
      { docNo: 'SL/INV/26-27/103' },
      { ...base, serial: 103, lines: [{ description: 'Other', qty: 1, taxableMinor: 500_000 }], projectTaxableMinor: undefined, advanceTaxableMinor: undefined, docType: 'regular' },
    );
    expect(push(h, seriesRow(a), 'GST_Series', a.docNo).ok).toBe(true);
    expect(push(h, seriesRow(b), 'GST_Series', b.docNo).ok).toBe(true);
    expect(sum(h, 'Q', 'Q2 (Jul-Sep)')).toBe(19999);
    expect(sum(h, 'W', 'Q2 (Jul-Sep)')).toBe(17699 + 5900);
    expect(sum(h, 'X', 'Q2 (Jul-Sep)')).toBe(0);

    // A payment arrives: the same row updates, nothing is duplicated.
    const paidModel = { ...base, paymentStatus: derivePaymentStatus('final', 1_769_900, 1_769_900, false) };
    const paid = context({ receivedMinor: 1_769_900 }, paidModel);
    push(h, seriesRow(paid), 'GST_Series', paid.docNo);
    expect(h.series.cell('F9')).toBeUndefined();
    expect(sum(h, 'X', 'Q2 (Jul-Sep)')).toBe(17699);
    expect(h.series.cell('Z7')).toBe('PAID IN FULL');

    // Cancelling the first invoice removes its money from the quarter but keeps its row and number.
    const cancelled = context({ cancelled: true, cancelReason: 'Issued in error' }, { ...base, paymentStatus: 'CANCELLED' });
    push(h, seriesRow(cancelled), 'GST_Series', cancelled.docNo);
    expect(h.series.cell('F7')).toBe('SL/INV/26-27/102');
    expect(h.series.cell('Z7')).toBe('CANCELLED');
    expect(sum(h, 'Q', 'Q2 (Jul-Sep)')).toBe(5000);
    expect(sum(h, 'X', 'Q2 (Jul-Sep)')).toBe(0);
    expect(String(h.series.cell('AD7'))).toContain('CANCELLED: Issued in error');
  });

  it('moves a draft through Pending into the register without losing its place', () => {
    const h = createHarness();
    const draft = context({}, { ...base, paymentStatus: 'PAYMENT PENDING' });
    push(h, pendingRow(draft), 'GST_Pending', draft.docNo);
    expect(h.pending.cell('R8')).toBe('Reserved / Pending');
    push(h, seriesRow(draft), 'GST_Series', draft.docNo);
    h.call({ action: 'upsertRow', sheet: 'GST_Pending', key: draft.docNo, onlyIfExists: true, ...pendingPromotion(draft) });
    expect(h.pending.cell('R8')).toBe('Promoted / Paid');
    expect(h.series.cell('F7')).toBe(draft.docNo);
  });

  it('writes ledger lines once per payment id, even when sent twice', () => {
    const h = createHarness();
    const c = context();
    const payment = { id: 'pay-1', amountMinor: 500_000, receivedAt: new Date('2026-07-10T06:00:00Z'), method: 'upi', note: '' };
    push(h, ledgerRow(c, payment), 'Pay_Ledger', payment.id);
    push(h, ledgerRow(c, payment), 'Pay_Ledger', payment.id);
    expect(h.ledger.cell('H6')).toBe(5000);
    expect(h.ledger.cell('N7')).toBeUndefined();
  });
});
