import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DEMO_DATA } from '../../../data/demo';
import type { CrmData } from '../../../data/types';
import { hashPassword } from '../../auth/password';
import { db } from '../../db/client';
import {
  activityEvents,
  aiAnalysisRuns,
  calendarEvents,
  clients,
  contactBriefs,
  conversationSummaries,
  conversations,
  invoiceItems,
  invoices,
  leadNotes,
  leads,
  messageAnalyses,
  messageMedia,
  messages,
  outboundJobs,
  payments,
  projects,
  proposalItems,
  proposals,
  recommendations,
  replyDrafts,
  users,
  workspaceMembers,
  workspaces,
} from '../../db/schema';

function dateValue(value: string | undefined | null): Date | null {
  return value ? new Date(value) : null;
}

function messageTimestamp(data: CrmData, leadId: string, fallback: string): Date {
  const latest = data.messages
    .filter((message) => message.leadId === leadId)
    .map((message) => new Date(message.sentAt).getTime())
    .sort((a, b) => b - a)[0];
  return new Date(latest ?? fallback);
}

export async function ensureUserAndWorkspace({
  email,
  name,
  password,
}: {
  email: string;
  name: string;
  password: string;
}) {
  const normalizedEmail = email.trim().toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);

  if (existing) {
    const [membership] = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, existing.id))
      .limit(1);
    if (membership) return { userId: existing.id, workspaceId: membership.workspaceId, created: false };

    const workspaceId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(workspaces).values({ id: workspaceId, name: `${name}'s workspace` });
      await tx.insert(workspaceMembers).values({ workspaceId, userId: existing.id, role: 'owner' });
    });
    return { userId: existing.id, workspaceId, created: false };
  }

  const userId = randomUUID();
  const workspaceId = randomUUID();
  const passwordHash = await hashPassword(password);

  await db.transaction(async (tx) => {
    await tx.insert(users).values({ id: userId, name, email: normalizedEmail, passwordHash });
    await tx.insert(workspaces).values({ id: workspaceId, name: `${name}'s workspace` });
    await tx.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner' });
  });

  return { userId, workspaceId, created: true };
}

export async function deleteCrmData(workspaceId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(replyDrafts).where(eq(replyDrafts.workspaceId, workspaceId));
    await tx.delete(recommendations).where(eq(recommendations.workspaceId, workspaceId));
    await tx.delete(contactBriefs).where(eq(contactBriefs.workspaceId, workspaceId));
    await tx.delete(conversationSummaries).where(eq(conversationSummaries.workspaceId, workspaceId));
    await tx.delete(messageAnalyses).where(eq(messageAnalyses.workspaceId, workspaceId));
    await tx.delete(aiAnalysisRuns).where(eq(aiAnalysisRuns.workspaceId, workspaceId));
    await tx.delete(projects).where(eq(projects.workspaceId, workspaceId));
    await tx.delete(activityEvents).where(eq(activityEvents.workspaceId, workspaceId));
    await tx.delete(outboundJobs).where(eq(outboundJobs.workspaceId, workspaceId));
    await tx.delete(messageMedia).where(eq(messageMedia.workspaceId, workspaceId));
    await tx.delete(messages).where(eq(messages.workspaceId, workspaceId));
    await tx.delete(conversations).where(eq(conversations.workspaceId, workspaceId));
    await tx.delete(leadNotes).where(eq(leadNotes.workspaceId, workspaceId));
    await tx.delete(calendarEvents).where(eq(calendarEvents.workspaceId, workspaceId));
    await tx.delete(payments).where(eq(payments.workspaceId, workspaceId));
    await tx.delete(invoices).where(eq(invoices.workspaceId, workspaceId));
    await tx.delete(proposals).where(eq(proposals.workspaceId, workspaceId));
    await tx.delete(leads).where(eq(leads.workspaceId, workspaceId));
    await tx.delete(clients).where(eq(clients.workspaceId, workspaceId));
  });
}

export async function seedDemoCrm(workspaceId: string, { replace = false } = {}) {
  const [existingLead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.workspaceId, workspaceId))
    .limit(1);

  if (existingLead && !replace) return { seeded: false };

  if (replace) await deleteCrmData(workspaceId);

  const data = structuredClone(DEMO_DATA);

  await db.transaction(async (tx) => {
    await tx.insert(clients).values(
      data.clients.map((client) => ({
        id: client.id,
        workspaceId,
        name: client.name,
        company: client.company,
        email: client.email,
        phone: client.phone,
        city: client.city,
        notes: client.notes,
        createdAt: new Date(client.createdAt),
      })),
    );

    await tx.insert(leads).values(
      data.leads.map((lead) => ({
        id: lead.id,
        workspaceId,
        name: lead.name,
        company: lead.company,
        phone: lead.phone,
        email: lead.email,
        city: lead.city,
        source: lead.source,
        initialMessage: lead.initialMessage,
        status: lead.status,
        valueMinor: lead.valueMinor,
        currency: lead.currency,
        ownerInitials: lead.ownerInitials,
        tags: lead.tags,
        clientId: lead.clientId ?? null,
        followUpAt: dateValue(lead.followUpAt),
        createdAt: new Date(lead.createdAt),
        lastActivityAt: new Date(lead.lastActivityAt),
      })),
    );

    const leadIdsWithMessages = [...new Set(data.messages.map((message) => message.leadId))];
    if (leadIdsWithMessages.length) {
      await tx.insert(conversations).values(
        leadIdsWithMessages.map((leadId) => {
          const lead = data.leads.find((item) => item.id === leadId)!;
          const latest = (direction: 'inbound' | 'outbound') =>
            data.messages
              .filter((message) => message.leadId === leadId && message.direction === direction)
              .map((message) => new Date(message.sentAt).getTime())
              .sort((a, b) => b - a)[0];
          const lastInbound = latest('inbound');
          const lastOutbound = latest('outbound');
          const unreadCount = data.messages.filter(
            (message) =>
              message.leadId === leadId &&
              message.direction === 'inbound' &&
              (!lastOutbound || new Date(message.sentAt).getTime() > lastOutbound),
          ).length;
          return {
            id: `conversation-${leadId}`,
            workspaceId,
            leadId,
            remoteJid: null,
            lastMessageAt: messageTimestamp(data, leadId, lead.createdAt),
            lastInboundAt: lastInbound ? new Date(lastInbound) : null,
            lastOutboundAt: lastOutbound ? new Date(lastOutbound) : null,
            lastReadAt: lastOutbound ? new Date(lastOutbound) : null,
            unreadCount,
          };
        }),
      );
    }

    await tx.insert(messages).values(
      data.messages.map((message) => ({
        id: message.id,
        workspaceId,
        leadId: message.leadId,
        conversationId: `conversation-${message.leadId}`,
        direction: message.direction,
        kind: 'text',
        body: message.body,
        source: message.source,
        state: message.state,
        sentAt: new Date(message.sentAt),
      })),
    );

    await tx.insert(proposals).values(
      data.proposals.map((proposal) => ({
        id: proposal.id,
        workspaceId,
        number: proposal.number,
        leadId: proposal.leadId ?? null,
        clientId: proposal.clientId ?? null,
        title: proposal.title,
        status: proposal.status,
        currency: proposal.currency,
        issuedAt: new Date(proposal.issuedAt),
        validUntil: new Date(proposal.validUntil),
        notes: proposal.notes,
        updatedAt: new Date(proposal.updatedAt),
      })),
    );

    const proposalItemRows = data.proposals.flatMap((proposal) =>
      proposal.lineItems.map((item, position) => ({
        id: `${proposal.id}-${item.id}`,
        proposalId: proposal.id,
        description: item.description,
        quantity: item.quantity,
        unitPriceMinor: item.unitPriceMinor,
        position,
      })),
    );
    if (proposalItemRows.length) await tx.insert(proposalItems).values(proposalItemRows);

    await tx.insert(invoices).values(
      data.invoices.map((invoice) => ({
        id: invoice.id,
        workspaceId,
        number: invoice.number,
        clientId: invoice.clientId,
        leadId: invoice.leadId ?? null,
        proposalId: invoice.proposalId ?? null,
        status: invoice.status,
        currency: invoice.currency,
        issuedAt: new Date(invoice.issuedAt),
        dueAt: new Date(invoice.dueAt),
        notes: invoice.notes,
        updatedAt: new Date(invoice.updatedAt),
      })),
    );

    const invoiceItemRows = data.invoices.flatMap((invoice) =>
      invoice.lineItems.map((item, position) => ({
        id: `${invoice.id}-${item.id}`,
        invoiceId: invoice.id,
        description: item.description,
        quantity: item.quantity,
        unitPriceMinor: item.unitPriceMinor,
        position,
      })),
    );
    if (invoiceItemRows.length) await tx.insert(invoiceItems).values(invoiceItemRows);

    await tx.insert(payments).values(
      data.payments.map((payment) => ({
        id: payment.id,
        workspaceId,
        invoiceId: payment.invoiceId,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        receivedAt: new Date(payment.receivedAt),
        method: payment.method,
        note: payment.note,
      })),
    );

    await tx.insert(projects).values([
      {
        id: 'project-1',
        workspaceId,
        clientId: 'client-4',
        leadId: 'lead-9',
        title: 'Northstar outdoor launch film',
        status: 'active',
        startsAt: new Date('2026-10-14T09:00:00'),
        dueAt: new Date('2026-10-24T18:00:00'),
      },
      {
        id: 'project-2',
        workspaceId,
        clientId: 'client-1',
        leadId: 'lead-4',
        title: 'Studio Ink editorial brand film',
        status: 'active',
        startsAt: new Date('2026-10-18T09:00:00'),
        dueAt: new Date('2026-11-06T18:00:00'),
      },
      {
        id: 'project-3',
        workspaceId,
        clientId: 'client-2',
        leadId: 'lead-5',
        title: 'Khanna annual gala coverage',
        status: 'active',
        startsAt: new Date('2026-10-20T09:00:00'),
        dueAt: new Date('2026-11-14T18:00:00'),
      },
    ]);

    await tx.insert(leadNotes).values(
      data.notes.map((note) => ({
        id: note.id,
        workspaceId,
        leadId: note.leadId,
        body: note.body,
        createdAt: new Date(note.createdAt),
      })),
    );

    await tx.insert(calendarEvents).values(
      data.events.map((event) => ({
        id: event.id,
        workspaceId,
        title: event.title,
        startsAt: new Date(event.startsAt),
        endsAt: new Date(event.endsAt),
        type: event.type,
        leadId: event.leadId ?? null,
        clientId: event.clientId ?? null,
        href: event.href ?? null,
      })),
    );

    await tx.insert(activityEvents).values({
      id: randomUUID(),
      workspaceId,
      entityType: 'workspace',
      entityId: workspaceId,
      action: 'demo.seeded',
      metadata: { leads: data.leads.length, clients: data.clients.length },
    });
  });

  return { seeded: true };
}

export async function findWorkspaceMembership(userId: string) {
  const [membership] = await db
    .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId)))
    .limit(1);
  return membership;
}
