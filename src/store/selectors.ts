import {
  addMinutes,
  eachMonthOfInterval,
  endOfMonth,
  format,
  isBefore,
  parseISO,
  startOfMonth,
  startOfQuarter,
  subMonths,
  subQuarters,
} from 'date-fns';
import { convertMinor, lineItemsTotalMinor, SAMPLE_RATES } from '../data/currencies';
import type {
  CalendarEvent,
  Client,
  Currency,
  CurrencyRates,
  Invoice,
  Lead,
  LeadStatus,
  Payment,
  Proposal,
} from '../data/types';

export const LEAD_STAGES: { status: LeadStatus; label: string }[] = [
  { status: 'new', label: 'New lead' },
  { status: 'connected', label: 'Connected' },
  { status: 'proposal_sent', label: 'Proposal sent' },
  { status: 'accepted', label: 'Accepted' },
  { status: 'payment_due', label: 'Payment due' },
  { status: 'paid', label: 'Payment received' },
];

export type PipelineColumn = {
  status: LeadStatus;
  label: string;
  count: number;
  valueMinor: number;
};

export function pipelineSummary(
  leads: Lead[],
  reportingCurrency: Currency,
  rates: CurrencyRates = SAMPLE_RATES,
): PipelineColumn[] {
  return LEAD_STAGES.map(({ status, label }) => {
    const stageLeads = leads.filter((lead) => lead.status === status);
    return {
      status,
      label,
      count: stageLeads.length,
      valueMinor: stageLeads.reduce(
        (total, lead) =>
          total + convertMinor(lead.valueMinor, lead.currency, reportingCurrency, rates),
        0,
      ),
    };
  });
}

export function invoiceTotalMinor(invoice: Invoice): number {
  return invoice.gst ? invoice.gst.totalMinor : lineItemsTotalMinor(invoice.lineItems);
}

export function invoicePaidMinor(invoice: Invoice, payments: Payment[]): number {
  return payments
    .filter((payment) => payment.invoiceId === invoice.id)
    .reduce((total, payment) => total + payment.amountMinor, 0);
}

export function invoiceBalanceMinor(invoice: Invoice, payments: Payment[]): number {
  // A cancelled invoice is owed nothing, whatever its original total was.
  if (invoice.gst?.cancelled) return 0;
  return Math.max(0, invoiceTotalMinor(invoice) - invoicePaidMinor(invoice, payments));
}

export type InvoiceDisplayStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';

export function invoiceDisplayStatus(
  invoice: Invoice,
  payments: Payment[],
  now = new Date(),
): InvoiceDisplayStatus {
  if (invoice.gst?.cancelled) return 'cancelled';
  const balance = invoiceBalanceMinor(invoice, payments);
  const paid = invoicePaidMinor(invoice, payments);
  if (balance === 0) return 'paid';
  if (isBefore(parseISO(invoice.dueAt), now)) return 'overdue';
  if (invoice.status === 'draft') return 'draft';
  if (paid > 0) return 'partially_paid';
  return 'sent';
}

export type DateRange = { start: Date; end: Date };

export function receivedRevenueForRange(
  payments: Payment[],
  reportingCurrency: Currency,
  rates: CurrencyRates,
  range: DateRange,
): number {
  return payments.reduce((total, payment) => {
    const received = parseISO(payment.receivedAt);
    if (received < range.start || received >= range.end) return total;
    return total + convertMinor(payment.amountMinor, payment.currency, reportingCurrency, rates);
  }, 0);
}

export type FinanceSummary = {
  receivedThisMonthMinor: number;
  previousMonthMinor: number;
  lastQuarterMinor: number;
  outstandingMinor: number;
  overdueMinor: number;
  overdueCount: number;
};

export function financeSummary({
  invoices,
  payments,
  reportingCurrency,
  rates,
  now,
}: {
  invoices: Invoice[];
  payments: Payment[];
  reportingCurrency: Currency;
  rates: CurrencyRates;
  now: Date;
}): FinanceSummary {
  const thisMonthStart = startOfMonth(now);
  const nextMonthStart = startOfMonth(subMonths(now, -1));
  const previousMonthStart = startOfMonth(subMonths(now, 1));
  const currentQuarterStart = startOfQuarter(now);
  const previousQuarterStart = startOfQuarter(subQuarters(now, 1));

  let outstandingMinor = 0;
  let overdueMinor = 0;
  let overdueCount = 0;

  for (const invoice of invoices) {
    const balance = invoiceBalanceMinor(invoice, payments);
    if (balance === 0) continue;
    const converted = convertMinor(balance, invoice.currency, reportingCurrency, rates);
    outstandingMinor += converted;
    if (isBefore(parseISO(invoice.dueAt), now)) {
      overdueMinor += converted;
      overdueCount += 1;
    }
  }

  return {
    receivedThisMonthMinor: receivedRevenueForRange(payments, reportingCurrency, rates, {
      start: thisMonthStart,
      end: nextMonthStart,
    }),
    previousMonthMinor: receivedRevenueForRange(payments, reportingCurrency, rates, {
      start: previousMonthStart,
      end: thisMonthStart,
    }),
    lastQuarterMinor: receivedRevenueForRange(payments, reportingCurrency, rates, {
      start: previousQuarterStart,
      end: currentQuarterStart,
    }),
    outstandingMinor,
    overdueMinor,
    overdueCount,
  };
}

export type MonthlyRevenuePoint = { month: string; label: string; valueMinor: number };

export function monthlyRevenueSeries(
  payments: Payment[],
  reportingCurrency: Currency,
  rates: CurrencyRates,
  now: Date,
  count = 6,
): MonthlyRevenuePoint[] {
  const end = endOfMonth(now);
  const start = startOfMonth(subMonths(now, count - 1));
  return eachMonthOfInterval({ start, end }).map((month) => {
    const next = startOfMonth(subMonths(month, -1));
    return {
      month: format(month, 'yyyy-MM'),
      label: format(month, 'MMM'),
      valueMinor: receivedRevenueForRange(payments, reportingCurrency, rates, {
        start: month,
        end: next,
      }),
    };
  });
}

export type ClientFinancialSummary = {
  receivedMinor: number;
  outstandingMinor: number;
  invoiceCount: number;
};

export function clientFinancials(
  clientId: string,
  invoices: Invoice[],
  payments: Payment[],
  reportingCurrency: Currency,
  rates: CurrencyRates = SAMPLE_RATES,
): ClientFinancialSummary {
  const clientInvoices = invoices.filter((invoice) => invoice.clientId === clientId);
  let receivedMinor = 0;
  let outstandingMinor = 0;

  for (const invoice of clientInvoices) {
    receivedMinor += convertMinor(
      invoicePaidMinor(invoice, payments),
      invoice.currency,
      reportingCurrency,
      rates,
    );
    outstandingMinor += convertMinor(
      invoiceBalanceMinor(invoice, payments),
      invoice.currency,
      reportingCurrency,
      rates,
    );
  }

  return { receivedMinor, outstandingMinor, invoiceCount: clientInvoices.length };
}

export function deriveCalendarEvents({
  leads,
  proposals,
  invoices,
  payments,
  manualEvents,
}: {
  leads: Lead[];
  proposals: Proposal[];
  invoices: Invoice[];
  payments: Payment[];
  manualEvents: CalendarEvent[];
}): CalendarEvent[] {
  const events: CalendarEvent[] = [...manualEvents];

  for (const lead of leads) {
    if (lead.followUpAt && lead.status !== 'paid') {
      const start = parseISO(lead.followUpAt);
      events.push({
        id: `follow-${lead.id}`,
        title: `Follow up · ${lead.name}`,
        startsAt: start.toISOString(),
        endsAt: addMinutes(start, 30).toISOString(),
        type: 'follow_up',
        leadId: lead.id,
        clientId: lead.clientId,
        href: `/leads/${lead.id}`,
      });
    }
  }

  for (const proposal of proposals) {
    if (proposal.status !== 'sent') continue;
    const start = parseISO(proposal.validUntil);
    events.push({
      id: `expiry-${proposal.id}`,
      title: `Proposal ${proposal.number} expires`,
      startsAt: start.toISOString(),
      endsAt: addMinutes(start, 30).toISOString(),
      type: 'proposal_expiry',
      clientId: proposal.clientId,
      leadId: proposal.leadId,
      href: `/proposals/${proposal.id}/edit`,
    });
  }

  for (const invoice of invoices) {
    if (invoiceBalanceMinor(invoice, payments) === 0) continue;
    const start = parseISO(invoice.dueAt);
    events.push({
      id: `due-${invoice.id}`,
      title: `${invoice.number} payment due`,
      startsAt: start.toISOString(),
      endsAt: addMinutes(start, 30).toISOString(),
      type: 'payment_due',
      clientId: invoice.clientId,
      leadId: invoice.leadId,
      href: `/invoices/${invoice.id}/edit`,
    });
  }

  return events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function leadForClient(client: Client, leads: Lead[]): Lead | undefined {
  return leads.find((lead) => lead.clientId === client.id) ?? leads.find((lead) => lead.name === client.name);
}
