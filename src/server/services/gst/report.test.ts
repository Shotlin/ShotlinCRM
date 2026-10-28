import { describe, expect, it } from 'vitest';
import { buildGstReport, type ReportDoc } from './report';

const base = { cancelled: false, gstin: null, stateName: 'Gujarat', stateCode: '24', project: 'P', taxRatePct: 18, cgstMinor: 0, sgstMinor: 0, receivedMinor: 0, lastPaidAt: null, advanceTaxableMinor: 0, advanceRef: null, status: 'sent' };
const doc = (o: Partial<ReportDoc> & Pick<ReportDoc, 'docNo' | 'docType' | 'issuedAt' | 'taxableMinor' | 'client'>): ReportDoc => {
  const tax = Math.round(o.taxableMinor * 0.18);
  return { ...base, igstMinor: tax, taxMinor: tax, grandMinor: o.taxableMinor + tax, ...o };
};
const d = (iso: string) => new Date(`${iso}T00:00:00+05:30`);

describe('GST report', () => {
  const adv = doc({ docNo: 'SL/ADV/26-27/101', docType: 'advance', issuedAt: d('2026-05-19'), taxableMinor: 1500000, client: 'Bakaloo', gstin: '24ABFFB1171P1ZD', status: 'paid', receivedMinor: 1770000, lastPaidAt: d('2026-05-19') });
  const fin = doc({ docNo: 'SL/INV/26-27/102', docType: 'final', issuedAt: d('2026-07-06'), taxableMinor: 1499900, client: 'Bakaloo', gstin: '24ABFFB1171P1ZD', advanceTaxableMinor: 1500000, advanceRef: 'SL/ADV/26-27/101 dated 19 May 2026' });
  const unpaid = doc({ docNo: 'SL/ADV/26-27/106', docType: 'advance', issuedAt: d('2026-10-01'), taxableMinor: 2000000, client: 'Bakaloo' });
  const draft = doc({ docNo: 'SL/ADV/26-27/105', docType: 'advance', issuedAt: d('2026-09-29'), taxableMinor: 900000, client: 'Empire', status: 'draft' });
  const b2c = doc({ docNo: 'SL/INV/26-27/101', docType: 'final', issuedAt: d('2026-05-13'), taxableMinor: 2999900, client: 'Radha' });
  const report = buildGstReport([adv, fin, unpaid, draft, b2c], [{ date: d('2026-08-10'), gstMinor: 50000, itcEligible: true }], '26-27', d('2026-10-28'));

  it('puts each document in the right quarter', () => {
    const [q1, q2, q3] = report.quarters;
    expect(q1.total.taxableMinor).toBe(1500000 + 2999900);
    expect(q2.total.taxableMinor).toBe(1499900);
    expect(q3.total.count).toBe(0);
  });
  it('splits B2B and B2C by GSTIN', () => {
    expect(report.quarters[0].b2b.taxableMinor).toBe(1500000);
    expect(report.quarters[0].b2c.taxableMinor).toBe(2999900);
  });
  it('keeps unpaid advances and drafts out of the totals but lists them', () => {
    expect(report.excluded.map((e) => e.docNo).sort()).toEqual(['SL/ADV/26-27/105', 'SL/ADV/26-27/106']);
    expect(report.year.count).toBe(3);
  });
  it('shows the advance adjusted in the later quarter and where its GST was paid', () => {
    const [adj] = report.quarters[1].adjustments;
    expect(adj.advanceDocNo).toBe('SL/ADV/26-27/101');
    expect(adj.advanceQuarter).toBe('Q1');
    expect(adj.gstAlreadyPaidMinor).toBe(270000);
    expect(report.openAdvances).toHaveLength(0);
  });
  it('subtracts input tax credit from the tax payable', () => {
    expect(report.quarters[1].itcMinor).toBe(50000);
    expect(report.quarters[1].netPayableMinor).toBe(report.quarters[1].total.taxMinor - 50000);
    expect(report.quarters[1].state).toBe('past');
    expect(report.quarters[2].state).toBe('current');
  });
  it('carries unused credit forward', () => {
    const r = buildGstReport([adv], [{ date: d('2026-08-10'), gstMinor: 900000, itcEligible: true }], '26-27', d('2026-10-28'));
    expect(r.quarters[0].netPayableMinor).toBe(270000);
    expect(r.quarters[1].creditLeftMinor).toBe(900000);
    expect(r.quarters[2].creditBroughtMinor).toBe(900000);
    expect(r.quarters[2].netPayableMinor).toBe(0);
  });
});
