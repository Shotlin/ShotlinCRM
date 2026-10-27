import { describe, expect, it } from 'vitest';
import type { CurrencyRates, Invoice, Lead, Payment, Proposal } from '../data/types';
import {
  clientFinancials,
  deriveCalendarEvents,
  financeSummary,
  invoiceBalanceMinor,
  invoiceDisplayStatus,
  pipelineSummary,
  receivedRevenueForRange,
} from './selectors';

const rates: CurrencyRates = { INR: 1, USD: 83, EUR: 90, GBP: 105 };

const lead = (overrides: Partial<Lead> = {}): Lead => ({
  id: 'lead-1',
  name: 'Riya Sharma',
  company: 'Riya Films',
  phone: '+91 98765 43210',
  email: 'riya@example.com',
  city: 'Mumbai',
  source: 'whatsapp',
  initialMessage: 'I need a wedding film.',
  status: 'new',
  valueMinor: 8_000_000,
  currency: 'INR',
  ownerInitials: 'SR',
  createdAt: '2026-10-20T09:00:00.000Z',
  lastActivityAt: '2026-10-20T09:00:00.000Z',
  tags: [],
  ...overrides,
});

const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: 'inv-1',
  number: 'SH-1042',
  clientId: 'client-1',
  status: 'sent',
  lineItems: [{ id: 'line-1', description: 'Film', quantity: 1, unitPriceMinor: 10_000_000 }],
  currency: 'INR',
  issuedAt: '2026-10-01T09:00:00.000Z',
  dueAt: '2026-10-20T09:00:00.000Z',
  notes: '',
  updatedAt: '2026-10-01T09:00:00.000Z',
  ...overrides,
});

const payment = (overrides: Partial<Payment> = {}): Payment => ({
  id: 'pay-1',
  invoiceId: 'inv-1',
  amountMinor: 4_000_000,
  currency: 'INR',
  receivedAt: '2026-10-15T09:00:00.000Z',
  method: 'bank',
  note: '',
  ...overrides,
});

describe('pipelineSummary', () => {
  it('groups lead counts and converts pipeline value into the reporting currency', () => {
    const summary = pipelineSummary(
      [
        lead({ id: 'a', status: 'new', valueMinor: 10_000_000, currency: 'INR' }),
        lead({ id: 'b', status: 'new', valueMinor: 1_000_000, currency: 'USD' }),
        lead({ id: 'c', status: 'paid', valueMinor: 2_000_000, currency: 'INR' }),
      ],
      'INR',
      rates,
    );

    expect(summary[0]).toMatchObject({ status: 'new', count: 2 });
    expect(summary[0].valueMinor).toBe(93_000_000);
    expect(summary[5]).toMatchObject({ status: 'paid', count: 1 });
  });
});

describe('invoiceBalanceMinor', () => {
  it('subtracts recorded payments from the invoice total', () => {
    expect(invoiceBalanceMinor(invoice(), [payment()])).toBe(6_000_000);
  });

  it('never reports a negative balance when an overpayment is recorded', () => {
    expect(invoiceBalanceMinor(invoice(), [payment({ amountMinor: 12_000_000 })])).toBe(0);
  });
});

describe('invoiceDisplayStatus', () => {
  const now = new Date('2026-10-27T12:00:00.000Z');

  it('stays overdue while a partial payment remains past the due date', () => {
    expect(invoiceDisplayStatus(invoice(), [payment()], now)).toBe('overdue');
  });

  it('becomes paid when the balance reaches zero', () => {
    expect(invoiceDisplayStatus(invoice(), [payment({ amountMinor: 10_000_000 })], now)).toBe('paid');
  });

  it('identifies a partial payment before the due date', () => {
    const future = invoice({ dueAt: '2026-11-20T09:00:00.000Z' });
    expect(invoiceDisplayStatus(future, [payment()], now)).toBe('partially_paid');
  });
});

describe('financeSummary', () => {
  const now = new Date('2026-10-27T12:00:00.000Z');

  it('recognises this month and the last completed quarter independently', () => {
    const payments = [
      payment({ id: 'oct', amountMinor: 2_000_000, receivedAt: '2026-10-08T09:00:00.000Z' }),
      payment({ id: 'aug', amountMinor: 3_000_000, receivedAt: '2026-08-11T09:00:00.000Z' }),
      payment({ id: 'sep', amountMinor: 4_000_000, receivedAt: '2026-09-11T09:00:00.000Z' }),
      payment({ id: 'jul', amountMinor: 5_000_000, receivedAt: '2026-07-11T09:00:00.000Z' }),
      payment({ id: 'jun', amountMinor: 9_000_000, receivedAt: '2026-06-11T09:00:00.000Z' }),
    ];

    const summary = financeSummary({
      invoices: [invoice()],
      payments,
      reportingCurrency: 'INR',
      rates,
      now,
    });

    expect(summary.receivedThisMonthMinor).toBe(2_000_000);
    expect(summary.lastQuarterMinor).toBe(12_000_000);
  });

  it('converts foreign-currency receipts to the reporting currency', () => {
    const usdInvoice = invoice({ id: 'usd', currency: 'USD' });
    const usdPayment = payment({ invoiceId: 'usd', currency: 'USD', amountMinor: 100_000 });
    const summary = financeSummary({
      invoices: [usdInvoice],
      payments: [usdPayment],
      reportingCurrency: 'INR',
      rates,
      now: new Date('2026-10-27T12:00:00.000Z'),
    });

    expect(summary.receivedThisMonthMinor).toBe(8_300_000);
  });
});

describe('receivedRevenueForRange', () => {
  it('includes the start boundary and excludes receipts at or after the end boundary', () => {
    const range = {
      start: new Date('2026-07-01T00:00:00'),
      end: new Date('2026-10-01T00:00:00'),
    };
    const total = receivedRevenueForRange(
      [
        payment({ id: 'start', amountMinor: 1_000_000, receivedAt: '2026-07-01T00:00:00.000' }),
        payment({ id: 'end', amountMinor: 2_000_000, receivedAt: '2026-10-01T00:00:00.000' }),
        payment({ id: 'outside', amountMinor: 9_000_000, receivedAt: '2026-10-02T00:00:00.000' }),
      ],
      'INR',
      rates,
      range,
    );
    expect(total).toBe(1_000_000);
  });
});

describe('clientFinancials', () => {
  it('derives received and outstanding value from invoices', () => {
    const result = clientFinancials(
      'client-1',
      [invoice()],
      [payment()],
      'INR',
      rates,
    );
    expect(result.receivedMinor).toBe(4_000_000);
    expect(result.outstandingMinor).toBe(6_000_000);
  });
});

describe('deriveCalendarEvents', () => {
  it('creates follow-up, proposal-expiry and overdue-payment entries with deep links', () => {
    const proposal: Proposal = {
      id: 'proposal-1',
      number: 'PR-1',
      title: 'Wedding film',
      status: 'sent',
      lineItems: [],
      currency: 'INR',
      issuedAt: '2026-10-01T09:00:00.000Z',
      validUntil: '2026-10-30T09:00:00.000Z',
      notes: '',
      updatedAt: '2026-10-01T09:00:00.000Z',
    };

    const events = deriveCalendarEvents({
      leads: [lead({ followUpAt: '2026-10-28T10:00:00.000Z' })],
      proposals: [proposal],
      invoices: [invoice()],
      payments: [],
      manualEvents: [],
    });

    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['follow_up', 'proposal_expiry', 'payment_due']),
    );
    expect(events.find((event) => event.type === 'follow_up')?.href).toBe('/leads/lead-1');
  });
});
