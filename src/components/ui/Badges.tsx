import { Infinity as MetaMark, MessageCircle } from 'lucide-react';
import type { InvoiceStatus, LeadSource, LeadStatus, ProposalStatus } from '../../data/types';
import type { InvoiceDisplayStatus } from '../../store/selectors';
import {
  INVOICE_STATUS_LABELS,
  LEAD_STATUS_LABELS,
  PROPOSAL_STATUS_LABELS,
  SOURCE_LABELS,
} from '../../lib/format';

type Tone = 'neutral' | 'blue' | 'amber' | 'green' | 'red' | 'violet';

const LEAD_TONES: Record<LeadStatus, Tone> = {
  new: 'neutral',
  connected: 'blue',
  proposal_sent: 'amber',
  accepted: 'violet',
  payment_due: 'red',
  paid: 'green',
};

const PROPOSAL_TONES: Record<ProposalStatus, Tone> = {
  draft: 'neutral',
  sent: 'blue',
  accepted: 'green',
  declined: 'red',
  expired: 'amber',
};

const INVOICE_TONES: Record<InvoiceStatus | InvoiceDisplayStatus, Tone> = {
  draft: 'neutral',
  sent: 'blue',
  partially_paid: 'amber',
  overdue: 'red',
  paid: 'green',
  cancelled: 'neutral',
};

export function StatusPill({
  status,
  kind = 'lead',
}: {
  status: LeadStatus | ProposalStatus | InvoiceStatus | InvoiceDisplayStatus;
  kind?: 'lead' | 'proposal' | 'invoice';
}) {
  const label =
    kind === 'lead'
      ? LEAD_STATUS_LABELS[status as LeadStatus]
      : kind === 'proposal'
        ? PROPOSAL_STATUS_LABELS[status as ProposalStatus]
        : INVOICE_STATUS_LABELS[status as InvoiceStatus | InvoiceDisplayStatus];
  const tone =
    kind === 'lead'
      ? LEAD_TONES[status as LeadStatus]
      : kind === 'proposal'
        ? PROPOSAL_TONES[status as ProposalStatus]
        : INVOICE_TONES[status as InvoiceStatus | InvoiceDisplayStatus];

  return (
    <span className={`pill pill-${tone}`}>
      <span className="pill-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function SourceBadge({ source }: { source: LeadSource }) {
  const Icon = source === 'whatsapp' ? MessageCircle : MetaMark;
  return (
    <span className={`source source-${source}`}>
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {SOURCE_LABELS[source]}
    </span>
  );
}
