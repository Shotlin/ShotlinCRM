import { describe, expect, it } from 'vitest';
import { derivePaymentStatus } from './calc';
import { deriveSupplyType, gstInvoiceInputSchema } from './validate';

const valid = {
  clientId: 'client-1',
  docType: 'final',
  issuedAt: '2026-07-06T06:00:00Z',
  customer: {
    name: 'Sample Client',
    address: '12 Example Street',
    cityStatePin: 'Surat - 395006, Gujarat',
    pan: 'AAAAA0000A',
    gstin: '24AAAAA0000A1Z5',
    placeOfSupply: 'Gujarat',
    stateCode: '24',
  },
  project: { name: 'Sample Project' },
  lines: [{ description: 'Balance', qty: 1, unitPriceMinor: 1_499_900 }],
  projectTaxableMinor: 2_999_900,
  advanceTaxableMinor: 1_500_000,
};

const messages = (input: unknown) => {
  const parsed = gstInvoiceInputSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
};

describe('gstInvoiceInputSchema', () => {
  it('accepts a consistent final invoice and applies the defaults', () => {
    const parsed = gstInvoiceInputSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.taxRatePct).toBe(18);
      expect(parsed.data.sac).toBe('998314');
    }
  });

  it('rejects a final invoice whose lines do not equal the balance', () => {
    const wrong = { ...valid, lines: [{ description: 'Balance', qty: 1, unitPriceMinor: 1_500_000 }] };
    expect(messages(wrong)).toContain('Line items must add up to the balance: total project value minus the advance');
  });

  it('rejects an advance larger than the project', () => {
    expect(messages({ ...valid, advanceTaxableMinor: 3_500_000 })).toContain(
      'The advance cannot be more than the total project value',
    );
  });

  it('rejects an advance invoice whose lines differ from the advance amount', () => {
    const advance = {
      ...valid,
      docType: 'advance',
      projectTaxableMinor: 5_000_000,
      advanceTaxableMinor: 1_100_000,
      lines: [{ description: 'Advance', qty: 1, unitPriceMinor: 2_400_000 }],
    };
    expect(messages(advance)).toContain('Line items must add up to the advance amount');
  });

  it('rejects a GSTIN from a different state than the place of supply', () => {
    const wrongState = { ...valid, customer: { ...valid.customer, gstin: '27AAAAA0000A1Z5' } };
    expect(messages(wrongState)).toContain('The GSTIN starts with a different state code than the place of supply');
  });

  it('rejects a PAN that does not match the PAN inside the GSTIN', () => {
    const wrongPan = { ...valid, customer: { ...valid.customer, pan: 'BBBBB1111B' } };
    expect(messages(wrongPan)).toContain('The PAN does not match the PAN inside the GSTIN');
  });

  it('allows an unregistered customer with no GSTIN or PAN', () => {
    const unregistered = { ...valid, customer: { ...valid.customer, gstin: undefined, pan: undefined } };
    expect(messages(unregistered)).toEqual([]);
  });

  it('rejects malformed identifiers and empty lines', () => {
    expect(messages({ ...valid, customer: { ...valid.customer, gstin: 'NOTAGSTIN' } })).toContain('GSTIN format is not valid');
    expect(messages({ ...valid, lines: [] }).length).toBeGreaterThan(0);
  });
});

describe('tax type follows the state', () => {
  it('uses CGST + SGST inside West Bengal and IGST elsewhere', () => {
    expect(deriveSupplyType('19')).toBe('intra');
    expect(deriveSupplyType('24')).toBe('inter');
  });
});

describe('derivePaymentStatus', () => {
  it('works out the status from money received, never from a typed label', () => {
    expect(derivePaymentStatus('final', 1_769_900, 0, false)).toBe('PAYABLE / DUE');
    expect(derivePaymentStatus('final', 1_769_900, 500_000, false)).toBe('PARTIALLY PAID');
    expect(derivePaymentStatus('final', 1_769_900, 1_769_900, false)).toBe('PAID IN FULL');
    expect(derivePaymentStatus('advance', 1_298_000, 0, false)).toBe('PAYMENT PENDING');
    expect(derivePaymentStatus('advance', 1_298_000, 1_298_000, false)).toBe('PAID / RECEIVED');
    expect(derivePaymentStatus('final', 1_769_900, 1_769_900, true)).toBe('CANCELLED');
  });
});
