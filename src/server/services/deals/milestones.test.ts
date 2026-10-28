import { describe, expect, it } from 'vitest';
import { describeMilestones, gstOf, invoicePlan, splitByPercent } from './milestones';

describe('milestones', () => {
  it('splits Fresh Cuts 85,000 into 50/30/20', () => {
    expect(splitByPercent(8_500_000, [50, 30, 20])).toEqual([4_250_000, 2_550_000, 1_700_000]);
  });
  it('keeps the total exact when a percentage does not divide evenly', () => {
    const parts = splitByPercent(6_000_000, [33.33, 46.67, 20]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(6_000_000);
  });
  it('matches the DEALKR agreement figures', () => {
    const rows = describeMilestones(6_000_000, 18, [2_000_000, 2_800_000, 1_200_000]);
    expect(rows.map((r) => r.grossMinor)).toEqual([2_360_000, 3_304_000, 1_416_000]);
    expect(rows[0].percent).toBe(33.33);
    expect(gstOf(8_500_000, 18)).toBe(1_530_000);
  });
  it('makes advance invoices first and a final invoice last that adjusts what was billed', () => {
    const parts = [2_000_000, 2_800_000, 1_200_000];
    expect(invoicePlan(parts, 0)).toMatchObject({ docType: 'advance', advanceTaxableMinor: 2_000_000, lineMinor: 2_000_000 });
    expect(invoicePlan(parts, 1)).toMatchObject({ docType: 'advance', advanceTaxableMinor: 2_800_000 });
    expect(invoicePlan(parts, 2)).toEqual({ docType: 'final', projectTaxableMinor: 6_000_000, advanceTaxableMinor: 4_800_000, lineMinor: 1_200_000 });
  });
});

import { milestoneInvoiceDraft, nextUnbilledMilestone, type DraftMilestone } from './milestones';

describe('milestone invoice drafts', () => {
  const list: DraftMilestone[] = [
    { id: 'm1', kind: 'agreed', title: 'Kickoff', baseMinor: 2_000_000, invoice: { number: 'SL/ADV/26-27/105', cancelled: false } },
    { id: 'm2', kind: 'agreed', title: 'UAT', baseMinor: 2_800_000, invoice: null },
    { id: 'm3', kind: 'agreed', title: 'Production', baseMinor: 1_200_000, invoice: null },
    { id: 'x1', kind: 'additional', title: 'Extra scope', baseMinor: 2_100_100, invoice: null },
  ];
  it('suggests the next agreed milestone first, then the additional charge', () => {
    expect(nextUnbilledMilestone(list)?.id).toBe('m2');
    expect(nextUnbilledMilestone(list.map((m) => ({ ...m, invoice: m.kind === 'additional' ? null : { number: 'x', cancelled: false } })))?.id).toBe('x1');
  });
  it('makes the last agreed milestone a final invoice that names the earlier advances', () => {
    const draft = milestoneInvoiceDraft(list, 'm3', 'DEALKR')!;
    expect(draft).toMatchObject({ docType: 'final', amountMinor: 1_200_000, projectTotalMinor: 6_000_000, advanceMinor: 4_800_000, advanceRef: 'SL/ADV/26-27/105' });
  });
  it('bills an additional charge as a regular invoice that leaves the advances alone', () => {
    expect(milestoneInvoiceDraft(list, 'x1', 'DEALKR')).toMatchObject({ docType: 'regular', amountMinor: 2_100_100, projectTotalMinor: null, advanceMinor: null });
  });
});
