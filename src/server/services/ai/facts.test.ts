import { describe, expect, it } from 'vitest';
import type {
  CalendarEvent,
  Client,
  Invoice,
  Lead,
  Message,
  Payment,
  Proposal,
} from '../../../data/types';
import { conversationFact, deriveOperationalRecommendations } from './facts';

const now = new Date('2026-10-27T11:30:00.000Z');
const leadId = 'lead-1';

const lead = (patch: Partial<Lead> = {}): Lead => ({
  id: leadId,
  name: 'Riya Sharma',
  company: 'Riya Films',
  phone: '+91 98765 43210',
  email: 'riya@example.com',
  city: 'Mumbai',
  source: 'whatsapp',
  initialMessage: 'We need a wedding film.',
  status: 'new',
  valueMinor: 8_000_000,
  currency: 'INR',
  ownerInitials: 'SR',
  createdAt: '2026-10-27T08:00:00.000Z',
  lastActivityAt: '2026-10-27T09:00:00.000Z',
  followUpAt: '2026-10-28T10:00:00.000Z',
  tags: [],
  ...patch,
});

const message = (patch: Partial<Message> = {}): Message => ({
  id: 'message-in',
  leadId,
  direction: 'inbound',
  body: 'Can you confirm December 12–13?',
  sentAt: '2026-10-27T09:00:00.000Z',
  source: 'whatsapp',
  state: 'read',
  ...patch,
});

const client: Client = {
  id: 'client-1',
  name: 'Riya Sharma',
  company: 'Riya Films',
  email: 'riya@example.com',
  phone: '+91 98765 43210',
  city: 'Mumbai',
  notes: '',
  createdAt: '2026-10-01T10:00:00.000Z',
};

const invoice: Invoice = {
  id: 'invoice-1',
  number: 'INV-001',
  clientId: client.id,
  leadId,
  status: 'sent',
  lineItems: [{ id: 'item-1', description: 'Film', quantity: 1, unitPriceMinor: 500_000 }],
  currency: 'INR',
  issuedAt: '2026-10-01T10:00:00.000Z',
  dueAt: '2026-10-20T10:00:00.000Z',
  notes: '',
  updatedAt: '2026-10-20T10:00:00.000Z',
};

const project = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  clientId: client.id,
  leadId,
  proposalId: null,
  title: 'Wedding film',
  status: 'active',
  startsAt: new Date('2026-10-01T10:00:00.000Z'),
  dueAt: new Date('2026-10-24T18:00:00.000Z'),
  completedAt: null,
  createdAt: now,
  updatedAt: now,
};

const payments: Payment[] = [];

describe('conversationFact', () => {
  it('recognises a new enquiry and ignores a queued outbound as a reply', () => {
    const fact = conversationFact({
      leadId,
      conversationId: 'conversation-1',
      messages: [
        message(),
        message({
          id: 'message-out',
          direction: 'outbound',
          body: 'Thanks for reaching out.',
          sentAt: '2026-10-27T09:15:00.000Z',
          state: 'queued',
        }),
      ],
      lastReadAt: null,
      now,
    });

    expect(fact).toMatchObject({
      awaitingReply: true,
      isFirstReply: true,
      unread: 1,
      delayMinutes: 150,
    });
  });

  it('does not call a follow-up a first reply after an earlier outbound', () => {
    const fact = conversationFact({
      leadId,
      conversationId: 'conversation-1',
      messages: [
        message({ sentAt: '2026-10-27T08:00:00.000Z' }),
        message({
          id: 'message-out',
          direction: 'outbound',
          body: 'Thanks for reaching out.',
          sentAt: '2026-10-27T09:00:00.000Z',
          state: 'read',
        }),
        message({
          id: 'message-in-2',
          body: 'December 12–13 works for us.',
          sentAt: '2026-10-27T11:00:00.000Z',
        }),
      ],
      lastReadAt: null,
      now,
    });

    expect(fact.awaitingReply).toBe(true);
    expect(fact.isFirstReply).toBe(false);
  });

  it('clears reply delay after a successfully sent outbound', () => {
    const fact = conversationFact({
      leadId,
      conversationId: 'conversation-1',
      messages: [
        message(),
        message({
          id: 'message-out',
          direction: 'outbound',
          body: 'Yes, those dates are available.',
          sentAt: '2026-10-27T10:00:00.000Z',
          state: 'sent',
        }),
      ],
      lastReadAt: now.toISOString(),
      now,
    });

    expect(fact.awaitingReply).toBe(false);
    expect(fact.isFirstReply).toBe(false);
    expect(fact.unread).toBe(0);
  });
});

describe('deriveOperationalRecommendations', () => {
  it('builds first-reply, overdue invoice, and overdue project recommendations', () => {
    const recommendations = deriveOperationalRecommendations({
      now,
      leads: [lead()],
      clients: [client],
      messages: [message()],
      conversations: [
        {
          id: 'conversation-1',
          leadId,
          lastReadAt: null,
        },
      ],
      proposals: [],
      invoices: [invoice],
      payments,
      projects: [project],
      events: [],
      analyses: new Map(),
      reportingCurrency: 'INR',
      firstResponseMinutes: 60,
    });

    expect(recommendations.map((item) => item.type)).toEqual(
      expect.arrayContaining(['first_reply', 'invoice_overdue', 'project_overdue']),
    );
    const firstReply = recommendations.find((item) => item.type === 'first_reply');
    expect(firstReply?.priority).toBe('high');
    expect(firstReply?.scoreFactors.map((factor) => factor.code)).toContain('first_response_sla');
    expect(
      recommendations.find((item) => item.type === 'invoice_overdue')?.priority,
    ).toBe('secondary');
    expect(
      recommendations.find((item) => item.type === 'project_overdue')?.priority,
    ).toBe('secondary');
  });

  it('does not duplicate a due follow-up when the same contact needs a reply', () => {
    const recommendations = deriveOperationalRecommendations({
      now,
      leads: [lead({ followUpAt: '2026-10-27T10:00:00.000Z' })],
      clients: [client],
      messages: [message()],
      conversations: [{ id: 'conversation-1', leadId, lastReadAt: null }],
      proposals: [],
      invoices: [],
      payments: [],
      projects: [],
      events: [],
      analyses: new Map(),
      reportingCurrency: 'INR',
      firstResponseMinutes: 60,
    });

    expect(recommendations.filter((item) => item.type === 'follow_up_due')).toHaveLength(0);
  });

  it('uses only confident, evidence-backed AI intent for semantic factors', () => {
    const withConfidentAnalysis = deriveOperationalRecommendations({
      now,
      leads: [lead({ status: 'connected' })],
      clients: [client],
      messages: [
        message({
          id: 'earlier-outbound',
          direction: 'outbound',
          body: 'Thanks for reaching out.',
          sentAt: '2026-10-27T08:30:00.000Z',
          state: 'read',
        }),
        message(),
      ],
      conversations: [{ id: 'conversation-1', leadId, lastReadAt: now.toISOString() }],
      proposals: [],
      invoices: [],
      payments: [],
      projects: [],
      events: [],
      analyses: new Map([
        [
          message().id,
          {
            intent: 'scope_change',
            urgency: 'high',
            needsReply: true,
            confidence: 90,
          },
        ],
      ]),
      reportingCurrency: 'INR',
      firstResponseMinutes: 60,
    });
    const semantic = withConfidentAnalysis.find((item) => item.type === 'reply_needed');
    expect(semantic?.priority).toBe('secondary');
    expect(semantic?.scoreFactors.map((factor) => factor.code)).toEqual(
      expect.arrayContaining(['buying_intent', 'ai_urgency']),
    );

    const withWeakAnalysis = deriveOperationalRecommendations({
      now,
      leads: [lead({ status: 'connected' })],
      clients: [client],
      messages: [
        message({
          id: 'earlier-outbound',
          direction: 'outbound',
          body: 'Thanks for reaching out.',
          sentAt: '2026-10-27T08:30:00.000Z',
          state: 'read',
        }),
        message(),
      ],
      conversations: [{ id: 'conversation-1', leadId, lastReadAt: now.toISOString() }],
      proposals: [],
      invoices: [],
      payments: [],
      projects: [],
      events: [],
      analyses: new Map([
        [
          message().id,
          {
            intent: 'scope_change',
            urgency: 'high',
            needsReply: true,
            confidence: 40,
          },
        ],
      ]),
      reportingCurrency: 'INR',
      firstResponseMinutes: 60,
    });
    const weak = withWeakAnalysis.find((item) => item.type === 'reply_needed');
    expect(weak?.scoreFactors.map((factor) => factor.code)).not.toEqual(
      expect.arrayContaining(['buying_intent', 'ai_urgency']),
    );
  });

  it('creates an expiring proposal recommendation from a real deadline', () => {
    const proposal: Proposal = {
      id: 'proposal-1',
      number: 'PR-001',
      clientId: client.id,
      leadId,
      title: 'Wedding film',
      status: 'sent',
      lineItems: [{ id: 'item-1', description: 'Film', quantity: 1, unitPriceMinor: 500_000 }],
      currency: 'INR',
      issuedAt: '2026-10-24T10:00:00.000Z',
      validUntil: '2026-10-28T10:00:00.000Z',
      notes: '',
      updatedAt: '2026-10-24T10:00:00.000Z',
    };
    const recommendations = deriveOperationalRecommendations({
      now,
      leads: [lead()],
      clients: [client],
      messages: [message({ sentAt: '2026-10-27T11:00:00.000Z' })],
      conversations: [{ id: 'conversation-1', leadId, lastReadAt: now.toISOString() }],
      proposals: [proposal],
      invoices: [],
      payments: [],
      projects: [],
      events: [],
      analyses: new Map(),
      reportingCurrency: 'INR',
      firstResponseMinutes: 60,
    });

    expect(recommendations.find((item) => item.type === 'proposal_expiring')).toMatchObject({
      priority: 'normal',
      evidence: [expect.objectContaining({ kind: 'proposal', id: 'proposal-1' })],
    });
  });

  it('adds today meetings without inventing project deadlines', () => {
    const events: CalendarEvent[] = [
      {
        id: 'event-1',
        title: 'Discovery call',
        startsAt: '2026-10-27T10:00:00.000Z',
        endsAt: '2026-10-27T10:30:00.000Z',
        type: 'meeting',
        leadId,
        clientId: client.id,
        href: `/leads/${leadId}`,
      },
    ];
    const recommendations = deriveOperationalRecommendations({
      now,
      leads: [lead()],
      clients: [client],
      messages: [message({ sentAt: '2026-10-27T11:00:00.000Z' })],
      conversations: [{ id: 'conversation-1', leadId, lastReadAt: now.toISOString() }],
      proposals: [],
      invoices: [],
      payments: [],
      projects: [],
      events,
      analyses: new Map(),
      reportingCurrency: 'INR',
      firstResponseMinutes: 60,
    });

    expect(recommendations.find((item) => item.type === 'meeting_today')?.title).toContain(
      'Discovery call',
    );
  });
});
