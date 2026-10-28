import { asc, desc, eq } from 'drizzle-orm';
import type {
  CalendarEvent,
  Client,
  CrmData,
  Invoice,
  Lead,
  LeadNote,
  Message,
  Payment,
  Proposal,
} from '../../../data/types';
import { db } from '../../db/client';
import { gstModelFromRows } from '../invoicing/model';
import {
  calendarEvents,
  clients,
  conversations,
  invoiceItems,
  invoices,
  leadNotes,
  leads,
  messageMedia,
  messages,
  payments,
  proposalItems,
  proposals,
  workspaces,
} from '../../db/schema';

const iso = (value: Date | null) => value?.toISOString();

export type CrmSnapshot = CrmData & {
  reportingCurrency: 'INR' | 'USD' | 'EUR' | 'GBP';
  workspaceName: string;
};

export async function loadCrmSnapshot(workspaceId: string): Promise<CrmSnapshot> {
  const [
    leadRows,
    clientRows,
    messageRows,
    mediaRows,
    proposalRows,
    proposalItemRows,
    invoiceRows,
    invoiceItemRows,
    paymentRows,
    noteRows,
    eventRows,
    workspaceRows,
    conversationRows,
  ] = await Promise.all([
    db.select().from(leads).where(eq(leads.workspaceId, workspaceId)).orderBy(desc(leads.createdAt)),
    db.select().from(clients).where(eq(clients.workspaceId, workspaceId)).orderBy(desc(clients.createdAt)),
    db.select().from(messages).where(eq(messages.workspaceId, workspaceId)).orderBy(asc(messages.sentAt)),
    db.select().from(messageMedia).where(eq(messageMedia.workspaceId, workspaceId)),
    db.select().from(proposals).where(eq(proposals.workspaceId, workspaceId)).orderBy(desc(proposals.updatedAt)),
    db
      .select({ item: proposalItems })
      .from(proposalItems)
      .innerJoin(proposals, eq(proposals.id, proposalItems.proposalId))
      .where(eq(proposals.workspaceId, workspaceId))
      .orderBy(asc(proposalItems.position)),
    db.select().from(invoices).where(eq(invoices.workspaceId, workspaceId)).orderBy(desc(invoices.updatedAt)),
    db
      .select({ item: invoiceItems })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
      .where(eq(invoices.workspaceId, workspaceId))
      .orderBy(asc(invoiceItems.position)),
    db.select().from(payments).where(eq(payments.workspaceId, workspaceId)).orderBy(desc(payments.receivedAt)),
    db.select().from(leadNotes).where(eq(leadNotes.workspaceId, workspaceId)).orderBy(desc(leadNotes.createdAt)),
    db.select().from(calendarEvents).where(eq(calendarEvents.workspaceId, workspaceId)).orderBy(asc(calendarEvents.startsAt)),
    db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1),
    db
      .select({ leadId: conversations.leadId, unreadCount: conversations.unreadCount })
      .from(conversations)
      .where(eq(conversations.workspaceId, workspaceId)),
  ]);
  const unreadByLead = new Map(conversationRows.map((row) => [row.leadId, row.unreadCount]));

  const proposalItemsByProposal = new Map<string, Proposal['lineItems']>();
  for (const { item } of proposalItemRows) {
    const list = proposalItemsByProposal.get(item.proposalId) ?? [];
    list.push({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
    });
    proposalItemsByProposal.set(item.proposalId, list);
  }

  const invoiceItemsByInvoice = new Map<string, Invoice['lineItems']>();
  for (const { item } of invoiceItemRows) {
    const list = invoiceItemsByInvoice.get(item.invoiceId) ?? [];
    list.push({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
    });
    invoiceItemsByInvoice.set(item.invoiceId, list);
  }

  const workspace = workspaceRows[0];
  const mediaByMessage = new Map<string, (typeof mediaRows)[number]>();
  for (const media of mediaRows) {
    if (media.messageId && media.state === 'ready') mediaByMessage.set(media.messageId, media);
  }

  const rawItemsByInvoice = new Map<string, (typeof invoiceItemRows)[number]['item'][]>();
  for (const { item } of invoiceItemRows) {
    const list = rawItemsByInvoice.get(item.invoiceId) ?? [];
    list.push(item);
    rawItemsByInvoice.set(item.invoiceId, list);
  }
  const gstSummary = (invoice: (typeof invoiceRows)[number]): Invoice['gst'] => {
    const built = gstModelFromRows(invoice, rawItemsByInvoice.get(invoice.id) ?? [], 0);
    if (!built) return undefined;
    return {
      docType: built.model.docType,
      series: built.model.series,
      totalMinor: built.totals.grandMinor,
      taxMinor: built.totals.taxMinor,
      cancelled: built.cancelled,
      projectName: built.model.project.name,
    };
  };

  const toLead = (lead: (typeof leadRows)[number]): Lead => ({
    id: lead.id,
    name: lead.name,
    company: lead.company,
    phone: lead.phone,
    email: lead.email,
    city: lead.city,
    source: lead.source as Lead['source'],
    initialMessage: lead.initialMessage,
    status: lead.status as Lead['status'],
    valueMinor: lead.valueMinor,
    currency: lead.currency as Lead['currency'],
    ownerInitials: lead.ownerInitials,
    createdAt: lead.createdAt.toISOString(),
    lastActivityAt: lead.lastActivityAt.toISOString(),
    followUpAt: iso(lead.followUpAt) ?? undefined,
    clientId: lead.clientId ?? undefined,
    tags: lead.tags,
    unread: unreadByLead.get(lead.id) ?? 0,
  });

  return {
    workspaceName: workspace?.name ?? 'Workspace',
    reportingCurrency: (workspace?.reportingCurrency ?? 'INR') as CrmSnapshot['reportingCurrency'],
    leads: leadRows.filter((lead) => lead.inPipeline).map(toLead),
    chats: leadRows.filter((lead) => !lead.inPipeline).map(toLead),
    clients: clientRows.map(
      (client): Client => ({
        id: client.id,
        name: client.name,
        company: client.company,
        email: client.email,
        phone: client.phone,
        city: client.city,
        notes: client.notes,
        createdAt: client.createdAt.toISOString(),
      }),
    ),
    messages: messageRows.map(
      (message): Message => {
        const media = mediaByMessage.get(message.id);
        return {
          id: message.id,
          leadId: message.leadId,
          direction: message.direction as Message['direction'],
          body: message.body,
          sentAt: message.sentAt.toISOString(),
          source: message.source as Message['source'],
          state: message.state as Message['state'],
          kind: message.kind as Message['kind'],
          media: media
            ? {
                id: media.id,
                mimeType: media.mimeType,
                filename: media.filename ?? undefined,
                url: `/api/media/${media.id}`,
              }
            : undefined,
        };
      },
    ),
    proposals: proposalRows.map(
      (proposal): Proposal => ({
        id: proposal.id,
        number: proposal.number,
        leadId: proposal.leadId ?? undefined,
        clientId: proposal.clientId ?? undefined,
        title: proposal.title,
        status: proposal.status as Proposal['status'],
        lineItems: proposalItemsByProposal.get(proposal.id) ?? [],
        currency: proposal.currency as Proposal['currency'],
        issuedAt: proposal.issuedAt.toISOString(),
        validUntil: proposal.validUntil.toISOString(),
        notes: proposal.notes,
        updatedAt: proposal.updatedAt.toISOString(),
      }),
    ),
    invoices: invoiceRows.map(
      (invoice): Invoice => ({
        id: invoice.id,
        number: invoice.number,
        clientId: invoice.clientId,
        leadId: invoice.leadId ?? undefined,
        proposalId: invoice.proposalId ?? undefined,
        status: invoice.status as Invoice['status'],
        lineItems: invoiceItemsByInvoice.get(invoice.id) ?? [],
        currency: invoice.currency as Invoice['currency'],
        issuedAt: invoice.issuedAt.toISOString(),
        dueAt: invoice.dueAt.toISOString(),
        notes: invoice.notes,
        updatedAt: invoice.updatedAt.toISOString(),
        gst: gstSummary(invoice),
      }),
    ),
    payments: paymentRows.map(
      (payment): Payment => ({
        id: payment.id,
        invoiceId: payment.invoiceId,
        amountMinor: payment.amountMinor,
        currency: payment.currency as Payment['currency'],
        receivedAt: payment.receivedAt.toISOString(),
        method: payment.method as Payment['method'],
        note: payment.note,
      }),
    ),
    notes: noteRows.map(
      (note): LeadNote => ({
        id: note.id,
        leadId: note.leadId,
        body: note.body,
        createdAt: note.createdAt.toISOString(),
      }),
    ),
    events: eventRows.map(
      (event): CalendarEvent => ({
        id: event.id,
        title: event.title,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        type: event.type as CalendarEvent['type'],
        leadId: event.leadId ?? undefined,
        clientId: event.clientId ?? undefined,
        href: event.href ?? undefined,
      }),
    ),
  };
}
