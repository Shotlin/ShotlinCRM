import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type {
  CalendarEvent,
  Client,
  Invoice,
  Lead,
  LeadNote,
  Message,
  Payment,
  Proposal,
} from '../../../data/types';
import type { Currency } from '../../../data/types';
import { db } from '../../db/client';
import {
  conversationSummaries,
  conversations,
  messageAnalyses,
  projects,
} from '../../db/schema';
import { loadCrmSnapshot } from '../crm/load';

export type ContactEvidence = {
  lead: Lead;
  client: Client | null;
  conversation: typeof conversations.$inferSelect | null;
  messages: Message[];
  analyses: (typeof messageAnalyses.$inferSelect)[];
  summaries: (typeof conversationSummaries.$inferSelect)[];
  proposals: Proposal[];
  invoices: Invoice[];
  payments: Payment[];
  projects: (typeof projects.$inferSelect)[];
  notes: LeadNote[];
  events: CalendarEvent[];
  reportingCurrency: Currency;
  revisionHash: string;
};

export async function loadContactEvidence(
  workspaceId: string,
  leadId: string,
): Promise<ContactEvidence> {
  const snapshot = await loadCrmSnapshot(workspaceId);
  const lead = snapshot.leads.find((item) => item.id === leadId);
  if (!lead) throw new Error('Lead not found in this workspace');
  const client = lead.clientId
    ? snapshot.clients.find((item) => item.id === lead.clientId) ?? null
    : null;

  const [conversationRows, analysisRows, projectRows] = await Promise.all([
    db
      .select()
      .from(conversations)
      .where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.leadId, leadId)))
      .limit(1),
    db
      .select()
      .from(messageAnalyses)
      .where(and(eq(messageAnalyses.workspaceId, workspaceId), eq(messageAnalyses.leadId, leadId))),
    db.select().from(projects).where(eq(projects.workspaceId, workspaceId)),
  ]);
  const conversation = conversationRows[0] ?? null;
  const summaries = conversation
    ? await db
        .select()
        .from(conversationSummaries)
        .where(
          and(
            eq(conversationSummaries.workspaceId, workspaceId),
            eq(conversationSummaries.conversationId, conversation.id),
          ),
        )
    : [];

  const messages = snapshot.messages
    .filter((message) => message.leadId === leadId)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const clientId = lead.clientId;
  const proposals = snapshot.proposals.filter(
    (proposal) =>
      proposal.leadId === leadId || (clientId !== undefined && proposal.clientId === clientId),
  );
  const proposalIds = new Set(proposals.map((proposal) => proposal.id));
  const invoices = snapshot.invoices.filter(
    (invoice) =>
      invoice.leadId === leadId ||
      (clientId !== undefined && invoice.clientId === clientId) ||
      (invoice.proposalId !== undefined && proposalIds.has(invoice.proposalId)),
  );
  const invoiceIds = new Set(invoices.map((invoice) => invoice.id));
  const payments = snapshot.payments.filter((payment) => invoiceIds.has(payment.invoiceId));
  const notes = snapshot.notes.filter((note) => note.leadId === leadId);
  const events = snapshot.events.filter(
    (event) =>
      event.leadId === leadId || (clientId !== undefined && event.clientId === clientId),
  );
  const linkedProjects = projectRows.filter(
    (project) =>
      project.leadId === leadId || (clientId !== undefined && project.clientId === clientId),
  );

  const revisionHash = createHash('sha256')
    .update(
      JSON.stringify({
        lead: [lead.id, lead.status, lead.valueMinor, lead.followUpAt, lead.lastActivityAt],
        client: client?.id ?? null,
        conversation: [conversation?.id, conversation?.lastReadAt?.toISOString() ?? null],
        messages: messages.map((message) => [message.id, message.sentAt, message.body]),
        analyses: analysisRows.map((analysis) => [analysis.messageId, analysis.analyzedAt.toISOString()]),
        proposals: proposals.map((proposal) => [proposal.id, proposal.status, proposal.updatedAt]),
        invoices: invoices.map((invoice) => [invoice.id, invoice.status, invoice.updatedAt]),
        payments: payments.map((payment) => [payment.id, payment.amountMinor]),
        projects: linkedProjects.map((project) => [
          project.id,
          project.status,
          project.dueAt.toISOString(),
        ]),
        notes: notes.map((note) => [note.id, note.createdAt]),
        events: events.map((event) => [event.id, event.startsAt]),
      }),
    )
    .digest('hex');

  return {
    lead,
    client,
    conversation,
    messages,
    analyses: analysisRows,
    summaries,
    proposals,
    invoices,
    payments,
    projects: linkedProjects,
    notes,
    events,
    reportingCurrency: snapshot.reportingCurrency,
    revisionHash,
  };
}

export function redactIdentifiers(text: string): string {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, (match) =>
      /^\d{4}-\d{2}-\d{2}/.test(match) ? match : '[phone]',
    );
}

function redactJson(value: unknown): unknown {
  if (typeof value === 'string') return redactIdentifiers(value);
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        redactJson(item),
      ]),
    );
  }
  return value;
}

export function evidencePromptPayload(
  evidence: ContactEvidence,
  redact: boolean,
  maxMessages = 60,
) {
  const rawMessages = evidence.messages.slice(-maxMessages);
  const rawIds = new Set(rawMessages.map((message) => message.id));
  const payload = {
    lead: {
      id: evidence.lead.id,
      name: evidence.lead.name,
      company: evidence.lead.company,
      phone: evidence.lead.phone,
      email: evidence.lead.email,
      city: evidence.lead.city,
      source: evidence.lead.source,
      status: evidence.lead.status,
      valueMinor: evidence.lead.valueMinor,
      currency: evidence.lead.currency,
      followUpAt: evidence.lead.followUpAt ?? null,
      initialMessage: evidence.lead.initialMessage,
      tags: evidence.lead.tags,
    },
    client: evidence.client
      ? {
          id: evidence.client.id,
          name: evidence.client.name,
          company: evidence.client.company,
          city: evidence.client.city,
          notes: evidence.client.notes,
        }
      : null,
    reportingCurrency: evidence.reportingCurrency,
    conversation: evidence.conversation
      ? {
          id: evidence.conversation.id,
          lastInboundAt: evidence.conversation.lastInboundAt?.toISOString() ?? null,
          lastOutboundAt: evidence.conversation.lastOutboundAt?.toISOString() ?? null,
        }
      : null,
    messages: rawMessages.map((message) => ({
      id: message.id,
      direction: message.direction,
      kind: message.kind ?? 'text',
      body: message.body,
      sentAt: message.sentAt,
      state: message.state,
    })),
    messageAnalyses: evidence.analyses
      .filter((analysis) => !rawIds.has(analysis.messageId))
      .slice(-100)
      .map((analysis) => ({
        messageId: analysis.messageId,
        language: analysis.language,
        summary: analysis.summary,
        intent: analysis.intent,
        sentiment: analysis.sentiment,
        urgency: analysis.urgency,
        needsReply: analysis.needsReply,
        requestedActions: analysis.requestedActions,
        commitments: analysis.commitments,
        confidence: analysis.confidence,
      })),
    conversationSummaries: evidence.summaries.map((summary) => ({
      firstMessageId: summary.firstMessageId,
      lastMessageId: summary.lastMessageId,
      messageCount: summary.messageCount,
      summary: summary.summary,
      openLoops: summary.openLoops,
      commitments: summary.commitments,
    })),
    proposals: evidence.proposals.map((proposal) => ({
      id: proposal.id,
      number: proposal.number,
      title: proposal.title,
      status: proposal.status,
      currency: proposal.currency,
      issuedAt: proposal.issuedAt,
      validUntil: proposal.validUntil,
      lineItems: proposal.lineItems,
      notes: proposal.notes,
    })),
    invoices: evidence.invoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      currency: invoice.currency,
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt,
      lineItems: invoice.lineItems,
      notes: invoice.notes,
      payments: evidence.payments
        .filter((payment) => payment.invoiceId === invoice.id)
        .map((payment) => ({
          amountMinor: payment.amountMinor,
          receivedAt: payment.receivedAt,
          method: payment.method,
        })),
    })),
    projects: evidence.projects.map((project) => ({
      id: project.id,
      title: project.title,
      status: project.status,
      startsAt: project.startsAt?.toISOString() ?? null,
      dueAt: project.dueAt.toISOString(),
      completedAt: project.completedAt?.toISOString() ?? null,
    })),
    notes: evidence.notes.map((note) => ({
      id: note.id,
      body: note.body,
      createdAt: note.createdAt,
    })),
    events: evidence.events.map((event) => ({
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      type: event.type,
    })),
  };
  return redact ? redactJson(payload) : payload;
}

export function evidenceSources(evidence: ContactEvidence, redact = false) {
  const scrub = redact ? redactIdentifiers : (value: string) => value;
  const sources = new Map<string, string>();
  for (const message of evidence.messages) {
    sources.set(
      message.id,
      scrub(message.body || `[${message.kind ?? 'media'} message]`),
    );
  }
  sources.set(
    evidence.lead.id,
    scrub(
      [
        evidence.lead.name,
        evidence.lead.company,
        evidence.lead.email,
        evidence.lead.city,
        evidence.lead.status,
        evidence.lead.initialMessage,
        evidence.lead.followUpAt ?? '',
      ].join(' '),
    ),
  );
  for (const proposal of evidence.proposals) {
    sources.set(
      proposal.id,
      scrub(
        [
          proposal.number,
          proposal.title,
          proposal.status,
          proposal.notes,
          ...proposal.lineItems.map((item) => item.description),
        ].join(' '),
      ),
    );
  }
  for (const invoice of evidence.invoices) {
    sources.set(
      invoice.id,
      scrub(
        [
          invoice.number,
          invoice.status,
          invoice.notes,
          ...invoice.lineItems.map((item) => item.description),
        ].join(' '),
      ),
    );
  }
  for (const project of evidence.projects) {
    sources.set(
      project.id,
      scrub([project.title, project.status, project.dueAt.toISOString()].join(' ')),
    );
  }
  for (const event of evidence.events) {
    sources.set(event.id, scrub([event.title, event.type, event.startsAt].join(' ')));
  }
  return sources;
}

export function serializeUntrusted(value: unknown) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e');
}
