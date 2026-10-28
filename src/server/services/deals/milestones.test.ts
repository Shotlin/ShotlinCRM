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
