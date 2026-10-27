import { createHash } from 'node:crypto';
import { convertMinor, formatMoney, lineItemsTotalMinor, SAMPLE_RATES } from '../../../data/currencies';
import type {
  AiPriority,
  EvidenceRef,
  RecommendationType,
  ScoreFactor,
} from '../../../data/ai';
import type {
  CalendarEvent,
  Client,
  Currency,
  Invoice,
  Lead,
  Message,
  Payment,
  Proposal,
} from '../../../data/types';
import { invoiceBalanceMinor } from '../../../store/selectors';
import { scoreCandidate } from './priority';

export type AnalysisFact = {
  intent: string;
  urgency: string;
  needsReply: boolean;
  confidence: number;
};

export type ProjectFact = {
  id: string;
  workspaceId: string;
  clientId: string;
  leadId: string | null;
  proposalId: string | null;
  title: string;
  status: string;
  startsAt: Date | null;
  dueAt: Date;
};

export type FactsInput = {
  now: Date;
  leads: Lead[];
  clients: Client[];
  messages: Message[];
  conversations: { id: string; leadId: string; lastReadAt: string | null }[];
  proposals: Proposal[];
  invoices: Invoice[];
  payments: Payment[];
  projects: ProjectFact[];
  events: CalendarEvent[];
  analyses: Map<string, AnalysisFact>;
  reportingCurrency: Currency;
  firstResponseMinutes: number;
};

export type ConversationFact = {
  leadId: string;
  conversationId: string | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  lastReadAt: Date | null;
  unread: number;
  awaitingReply: boolean;
  isFirstReply: boolean;
  delayMinutes: number;
};

export type DerivedRecommendation = {
  fingerprint: string;
  type: RecommendationType;
  leadId: string | null;
  clientId: string | null;
  title: string;
  explanation: string;
  quote: string;
  priority: AiPriority;
  score: number;
  scoreFactors: ScoreFactor[];
  evidence: EvidenceRef[];
  dueAt: Date | null;
  waitingSince: Date | null;
  leadName: string;
  source: Lead['source'] | null;
};

const successfulOutbound = new Set(['sent', 'delivered', 'read', 'sample']);
const activeLeadStatuses = new Set(['new', 'connected', 'proposal_sent', 'accepted', 'payment_due']);
const buyingIntents = new Set([
  'enquiry',
  'scope_change',
  'proposal_question',
  'payment',
  'scheduling',
]);

function usefulMessage(message: Message) {
  return Boolean(message.body.trim()) || Boolean(message.kind && message.kind !== 'text');
}

export function conversationFact(input: {
  leadId: string;
  conversationId: string | null;
  messages: Message[];
  lastReadAt: string | null;
  now: Date;
}): ConversationFact {
  const messages = [...input.messages]
    .filter((message) => message.leadId === input.leadId && usefulMessage(message))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const inbound = messages.filter((message) => message.direction === 'inbound');
  const outbound = messages.filter(
    (message) => message.direction === 'outbound' && successfulOutbound.has(message.state),
  );
  const latestInbound = inbound.at(-1);
  const latestOutbound = outbound.at(-1);
  const lastInboundAt = latestInbound ? new Date(latestInbound.sentAt) : null;
  const lastOutboundAt = latestOutbound ? new Date(latestOutbound.sentAt) : null;
  const lastReadAt = input.lastReadAt ? new Date(input.lastReadAt) : null;
  const awaitingReply = Boolean(
    lastInboundAt && (!lastOutboundAt || lastInboundAt.getTime() > lastOutboundAt.getTime()),
  );
  const isFirstReply = Boolean(latestInbound && !latestOutbound);
  const unread = inbound.filter(
    (message) => !lastReadAt || new Date(message.sentAt).getTime() > lastReadAt.getTime(),
  ).length;
  const delayMinutes =
    awaitingReply && lastInboundAt
      ? Math.max(0, Math.floor((input.now.getTime() - lastInboundAt.getTime()) / 60_000))
      : 0;

  return {
    leadId: input.leadId,
    conversationId: input.conversationId,
    lastInboundAt,
    lastOutboundAt,
    lastReadAt,
    unread,
    awaitingReply,
    isFirstReply,
    delayMinutes,
  };
}

export function formatDelay(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

function fingerprint(parts: (string | number)[]) {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function valuePointsFor(lead: Lead, leads: Lead[], reportingCurrency: Currency): number {
  const values = leads
    .filter((item) => activeLeadStatuses.has(item.status) && item.valueMinor > 0)
    .map((item) => convertMinor(item.valueMinor, item.currency, reportingCurrency, SAMPLE_RATES))
    .sort((a, b) => a - b);
  if (!values.length || lead.valueMinor <= 0) return 0;
  const value = convertMinor(lead.valueMinor, lead.currency, reportingCurrency, SAMPLE_RATES);
  const rank = values.findIndex((candidate) => candidate >= value) / Math.max(1, values.length - 1);
  if (rank >= 0.75) return 10;
  if (rank >= 0.5) return 6;
  return 3;
}

function daysOverdue(now: Date, dueAt: Date) {
  return Math.max(1, Math.floor((now.getTime() - dueAt.getTime()) / 86_400_000));
}

function clientForLead(lead: Lead | undefined, clients: Client[]) {
  return lead?.clientId ? clients.find((client) => client.id === lead.clientId) : undefined;
}

export function deriveOperationalRecommendations(input: FactsInput): DerivedRecommendation[] {
  const results: DerivedRecommendation[] = [];
  const leadById = new Map(input.leads.map((lead) => [lead.id, lead]));
  const clientById = new Map(input.clients.map((client) => [client.id, client]));
  const conversationByLead = new Map(
    input.conversations.map((conversation) => [conversation.leadId, conversation]),
  );
  const messagesByLead = new Map<string, Message[]>();
  for (const message of input.messages) {
    const list = messagesByLead.get(message.leadId) ?? [];
    list.push(message);
    messagesByLead.set(message.leadId, list);
  }

  const facts = input.leads.map((lead) => {
    const conversation = conversationByLead.get(lead.id);
    return conversationFact({
      leadId: lead.id,
      conversationId: conversation?.id ?? null,
      messages: messagesByLead.get(lead.id) ?? [],
      lastReadAt: conversation?.lastReadAt ?? null,
      now: input.now,
    });
  });
  const awaitingLeadIds = new Set(facts.filter((fact) => fact.awaitingReply).map((fact) => fact.leadId));

  for (const fact of facts) {
    if (!fact.awaitingReply || !fact.lastInboundAt) continue;
    const lead = leadById.get(fact.leadId);
    if (!lead) continue;
    const conversationMessages = [...(messagesByLead.get(lead.id) ?? [])]
      .filter((message) => message.direction === 'inbound' && usefulMessage(message))
      .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    const latest = conversationMessages.at(-1);
    const latestAnalysis = latest ? input.analyses.get(latest.id) : undefined;
    const buyingIntent = fact.isFirstReply || Boolean(
      latestAnalysis &&
        latestAnalysis.confidence >= 70 &&
        buyingIntents.has(latestAnalysis.intent),
    );
    const aiUrgent = Boolean(
      latestAnalysis && latestAnalysis.confidence >= 70 && latestAnalysis.urgency === 'high',
    );
    const scored = scoreCandidate({
      now: input.now,
      type: fact.isFirstReply ? 'first_reply' : 'reply_needed',
      waitingSince: fact.lastInboundAt,
      firstResponseTargetMinutes: input.firstResponseMinutes,
      isNew: fact.isFirstReply,
      unread: fact.unread > 0,
      buyingIntent,
      aiUrgent,
      valuePoints: valuePointsFor(lead, input.leads, input.reportingCurrency),
    });
    const source = latest?.body.trim() || 'Media message';
    results.push({
      fingerprint: fingerprint([
        fact.isFirstReply ? 'first_reply' : 'reply_needed',
        lead.id,
        fact.lastInboundAt.toISOString(),
      ]),
      type: fact.isFirstReply ? 'first_reply' : 'reply_needed',
      leadId: lead.id,
      clientId: lead.clientId ?? null,
      title: fact.isFirstReply
        ? `${lead.name} is waiting for a first reply`
        : `${lead.name} is waiting for a reply`,
      explanation: `${fact.isFirstReply ? 'New enquiry' : 'Reply needed'} · waiting ${formatDelay(fact.delayMinutes)}`,
      quote: source.slice(0, 500),
      priority: scored.priority,
      score: scored.score,
      scoreFactors: scored.factors,
      evidence: [
        {
          kind: 'message',
          id: latest?.id ?? `${lead.id}-inbound`,
          label: fact.isFirstReply ? 'New enquiry' : 'Latest inbound message',
          quote: source.slice(0, 500),
        },
      ],
      dueAt: fact.lastInboundAt,
      waitingSince: fact.lastInboundAt,
      leadName: lead.name,
      source: lead.source,
    });
  }

  for (const invoice of input.invoices) {
    const balance = invoiceBalanceMinor(invoice, input.payments);
    const dueAt = new Date(invoice.dueAt);
    if (invoice.status !== 'sent' || balance <= 0 || dueAt >= input.now) continue;
    const lead = invoice.leadId ? leadById.get(invoice.leadId) : undefined;
    const client = clientById.get(invoice.clientId);
    const scored = scoreCandidate({ now: input.now, type: 'invoice_overdue', overdueInvoice: true });
    const days = daysOverdue(input.now, dueAt);
    results.push({
      fingerprint: fingerprint(['invoice_overdue', invoice.id, invoice.dueAt]),
      type: 'invoice_overdue',
      leadId: lead?.id ?? null,
      clientId: invoice.clientId,
      title: `Invoice ${invoice.number} is ${days} ${days === 1 ? 'day' : 'days'} overdue`,
      explanation: `${formatMoney(balance, invoice.currency)} outstanding`,
      quote: invoice.notes || `Payment was due on ${invoice.dueAt.slice(0, 10)}.`,
      priority: scored.priority,
      score: scored.score,
      scoreFactors: scored.factors,
      evidence: [{ kind: 'invoice', id: invoice.id, label: issuanceLabel(invoice), quote: formatMoney(balance, invoice.currency) }],
      dueAt,
      waitingSince: null,
      leadName: lead?.name ?? client?.name ?? 'Client',
      source: lead?.source ?? null,
    });
  }

  for (const proposal of input.proposals) {
    if (proposal.status !== 'sent') continue;
    const dueAt = new Date(proposal.validUntil);
    const remaining = dueAt.getTime() - input.now.getTime();
    if (remaining > 48 * 3_600_000) continue;
    const lead = proposal.leadId ? leadById.get(proposal.leadId) : undefined;
    const client = proposal.clientId ? clientById.get(proposal.clientId) : undefined;
    const expired = remaining < 0;
    const scored = scoreCandidate({
      now: input.now,
      type: 'proposal_expiring',
      proposalExpired: expired,
      proposalExpiring: !expired,
    });
    results.push({
      fingerprint: fingerprint(['proposal_expiring', proposal.id, proposal.validUntil]),
      type: 'proposal_expiring',
      leadId: lead?.id ?? null,
      clientId: proposal.clientId ?? null,
      title: expired
        ? `Proposal ${proposal.number} has expired`
        : `Proposal ${proposal.number} expires soon`,
      explanation: expired
        ? `${formatMoney(lineItemsTotalMinor(proposal.lineItems), proposal.currency)} proposal needs a decision`
        : `${formatMoney(lineItemsTotalMinor(proposal.lineItems), proposal.currency)} · due within 48 hours`,
      quote: proposal.title,
      priority: scored.priority,
      score: scored.score,
      scoreFactors: scored.factors,
      evidence: [{ kind: 'proposal', id: proposal.id, label: proposal.number, quote: proposal.title }],
      dueAt,
      waitingSince: null,
      leadName: lead?.name ?? client?.name ?? 'Client',
      source: lead?.source ?? null,
    });
  }

  for (const lead of input.leads) {
    if (!lead.followUpAt || lead.status === 'paid' || awaitingLeadIds.has(lead.id)) continue;
    const dueAt = new Date(lead.followUpAt);
    if (dueAt > input.now) continue;
    const scored = scoreCandidate({ now: input.now, type: 'follow_up_due', followUpDue: true });
    results.push({
      fingerprint: fingerprint(['follow_up_due', lead.id, lead.followUpAt]),
      type: 'follow_up_due',
      leadId: lead.id,
      clientId: lead.clientId ?? null,
      title: `Follow up with ${lead.name}`,
      explanation: `Committed follow-up was due ${formatDelay(
        Math.floor((input.now.getTime() - dueAt.getTime()) / 60_000),
      )} ago`,
      quote: lead.initialMessage,
      priority: scored.priority,
      score: scored.score,
      scoreFactors: scored.factors,
      evidence: [{ kind: 'lead', id: lead.id, label: 'Follow-up', quote: lead.initialMessage }],
      dueAt,
      waitingSince: null,
      leadName: lead.name,
      source: lead.source,
    });
  }

  for (const project of input.projects) {
    if (project.status !== 'active' || project.dueAt >= input.now) continue;
    const lead = project.leadId ? leadById.get(project.leadId) : undefined;
    const client = clientById.get(project.clientId) ?? clientForLead(lead, input.clients);
    const scored = scoreCandidate({ now: input.now, type: 'project_overdue', overdueProject: true });
    const days = daysOverdue(input.now, project.dueAt);
    results.push({
      fingerprint: fingerprint(['project_overdue', project.id, project.dueAt.toISOString()]),
      type: 'project_overdue',
      leadId: lead?.id ?? project.leadId,
      clientId: project.clientId,
      title: `${project.title} is ${days} ${days === 1 ? 'day' : 'days'} overdue`,
      explanation: 'Active project past its agreed deadline',
      quote: `Deadline was ${project.dueAt.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })}`,
      priority: scored.priority,
      score: scored.score,
      scoreFactors: scored.factors,
      evidence: [
        {
          kind: 'project',
          id: project.id,
          label: project.title,
          quote: project.dueAt.toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }),
        },
      ],
      dueAt: project.dueAt,
      waitingSince: null,
      leadName: lead?.name ?? client?.name ?? 'Client',
      source: lead?.source ?? null,
    });
  }

  const todayEvents = input.events
    .filter((event) => new Date(event.startsAt).toDateString() === input.now.toDateString())
    .slice(0, 5);
  for (const event of todayEvents) {
    const lead = event.leadId ? leadById.get(event.leadId) : undefined;
    const client = event.clientId ? clientById.get(event.clientId) : undefined;
    const scored = scoreCandidate({ now: input.now, type: 'meeting_today', meetingToday: true });
    results.push({
      fingerprint: fingerprint(['meeting_today', event.id, event.startsAt]),
      type: 'meeting_today',
      leadId: lead?.id ?? null,
      clientId: event.clientId ?? null,
      title: event.title,
      explanation: 'Scheduled today',
      quote: new Date(event.startsAt).toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
      }),
      priority: scored.priority,
      score: scored.score,
      scoreFactors: scored.factors,
      evidence: [{ kind: 'calendar', id: event.id, label: event.title, quote: new Date(event.startsAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) }],
      dueAt: new Date(event.startsAt),
      waitingSince: null,
      leadName: lead?.name ?? client?.name ?? 'Workspace',
      source: lead?.source ?? null,
    });
  }

  return results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aDue = a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bDue = b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aDue - bDue;
  });
}

function issuanceLabel(invoice: Invoice) {
  return `${invoice.number} · ${invoice.currency}`;
}
