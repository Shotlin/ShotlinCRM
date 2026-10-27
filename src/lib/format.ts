import { format, formatDistanceToNowStrict, isToday, isTomorrow, parseISO } from 'date-fns';
import type {
  InvoiceStatus,
  LeadSource,
  LeadStatus,
  PaymentMethod,
  ProposalStatus,
} from '../data/types';
import type { InvoiceDisplayStatus } from '../store/selectors';

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New lead',
  connected: 'Connected',
  proposal_sent: 'Proposal sent',
  accepted: 'Accepted',
  payment_due: 'Payment due',
  paid: 'Payment received',
};

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus | InvoiceDisplayStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  overdue: 'Overdue',
};

export const SOURCE_LABELS: Record<LeadSource, string> = {
  meta: 'Meta',
  whatsapp: 'WhatsApp',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank: 'Bank transfer',
  upi: 'UPI',
  card: 'Card',
  cash: 'Cash',
  other: 'Other',
};

export function formatDate(value: string | Date, pattern = 'dd MMM yyyy'): string {
  const date = typeof value === 'string' ? parseISO(value) : value;
  return format(date, pattern);
}

export function formatDateTime(value: string | Date): string {
  return formatDate(value, 'dd MMM · h:mm a');
}

export function formatRelative(value: string): string {
  return formatDistanceToNowStrict(parseISO(value), { addSuffix: true });
}

export function formatFollowUp(value: string): string {
  const date = parseISO(value);
  if (isToday(date)) return `Today, ${format(date, 'h:mm a')}`;
  if (isTomorrow(date)) return `Tomorrow, ${format(date, 'h:mm a')}`;
  return format(date, 'EEE, d MMM · h:mm a');
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function parseMoneyInput(value: string): number {
  const numeric = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
}

export function toMoneyInput(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2).replace(/\.00$/, '');
}

export function monthKey(value: string): string {
  return format(parseISO(value), 'yyyy-MM');
}
