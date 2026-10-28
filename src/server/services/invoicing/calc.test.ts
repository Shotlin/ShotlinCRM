import { describe, expect, it } from 'vitest';
import {
  amountInWords,
  computeTotals,
  documentNumber,
  financialYear,
  formatMoney,
  quarterLabel,
  type GstInvoice,
} from './calc';

const base: GstInvoice = {
  docType: 'final',
  series: 'INV',
  serial: 102,
  issuedAt: new Date('2026-07-06T06:00:00Z'),
  sac: '998314',
  supplyType: 'inter',
  taxRatePct: 18,
  paymentTerms: '',
  paymentStatus: '',
  customer: { name: 'A', address: '', cityStatePin: '', placeOfSupply: 'Gujarat', stateCode: '24' },
  project: { name: 'P' },
  lines: [{ description: 'Balance', qty: 1, taxableMinor: 1_499_900 }],
  projectTaxableMinor: 2_999_900,
  advanceTaxableMinor: 1_500_000,
  gstTreatment: '',
  terms: [],
};

describe('computeTotals', () => {
  // These figures are taken from the issued invoice SL/INV/26-27/102.
  it('matches an issued inter-state final invoice, including the rupee round-off', () => {
    const totals = computeTotals(base);
    expect(totals.igstMinor).toBe(269_982);
    expect(totals.roundOffMinor).toBe(18);
    expect(totals.grandMinor).toBe(1_769_900);
    expect(totals.rows.map((row) => row.label)).toEqual([
      'Total Project Taxable Value',
      'Less: Advance Taxable Value',
      'Balance Taxable Value',
      'IGST @ 18% (SAC 998314)',
      'Round Off',
      'TOTAL PAYABLE',
    ]);
  });

  it('matches an issued advance invoice with no round-off row', () => {
    const totals = computeTotals({
      ...base,
      docType: 'advance',
      series: 'ADV',
      lines: [{ description: 'Advance', qty: 1, taxableMinor: 1_100_000 }],
      projectTaxableMinor: 5_000_000,
      advanceTaxableMinor: 1_100_000,
    });
    expect(totals.igstMinor).toBe(198_000);
    expect(totals.grandMinor).toBe(1_298_000);
    expect(totals.rows.at(-1)).toMatchObject({ label: 'TOTAL ADVANCE RECEIVED', valueMinor: 1_298_000 });
    expect(totals.rows.some((row) => row.label === 'Round Off')).toBe(false);
  });

  it('splits intra-state tax into equal CGST and SGST', () => {
    const totals = computeTotals({ ...base, supplyType: 'intra' });
    expect(totals.cgstMinor).toBe(134_991);
    expect(totals.sgstMinor).toBe(134_991);
    expect(totals.igstMinor).toBe(0);
    expect(totals.taxRateLabel).toBe('CGST 9% + SGST 9%');
    expect(totals.grandMinor).toBe(1_769_900);
  });

  it('keeps every amount an exact whole number of paise', () => {
    const totals = computeTotals({ ...base, lines: [{ description: 'x', qty: 1, taxableMinor: 3_333_33 }] });
    for (const value of [totals.igstMinor, totals.roundOffMinor, totals.grandMinor]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});

describe('amountInWords', () => {
  it('uses the Indian lakh and crore system', () => {
    expect(amountInWords(1_769_900)).toBe('Seventeen Thousand Six Hundred Ninety-Nine Rupees Only');
    expect(amountInWords(1_298_000)).toBe('Twelve Thousand Nine Hundred Eighty Rupees Only');
    expect(amountInWords(15_398_800)).toBe('One Lakh Fifty-Three Thousand Nine Hundred Eighty-Eight Rupees Only');
    expect(amountInWords(1_00_00_000_00)).toBe('One Crore Rupees Only');
  });

  it('adds paise when present', () => {
    expect(amountInWords(10_050)).toBe('One Hundred Rupees and Fifty Paise Only');
  });
});

describe('formatting, financial year and numbering', () => {
  it('formats money with Indian grouping', () => {
    expect(formatMoney(1_769_900)).toBe('Rs. 17,699.00');
    expect(formatMoney(15_398_800)).toBe('Rs. 1,53,988.00');
  });

  it('uses the April to March financial year in Indian time', () => {
    expect(financialYear(new Date('2026-07-06T06:00:00Z')).label).toBe('26-27');
    expect(financialYear(new Date('2027-03-31T10:00:00Z')).label).toBe('26-27');
    // 20:00 UTC on 31 March is already 1 April in India.
    expect(financialYear(new Date('2027-03-31T20:00:00Z')).label).toBe('27-28');
    expect(quarterLabel(new Date('2026-07-06T06:00:00Z'))).toBe('Q2 (Jul-Sep)');
    expect(quarterLabel(new Date('2027-02-10T06:00:00Z'))).toBe('Q4 (Jan-Mar)');
  });

  it('builds the document number from series, year and serial', () => {
    expect(documentNumber(base)).toBe('SL/INV/26-27/102');
    expect(documentNumber({ ...base, series: 'ADV', serial: 107 })).toBe('SL/ADV/26-27/107');
  });
});
