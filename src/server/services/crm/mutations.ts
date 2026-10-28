import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../../db/client';
import { markDriveDirty } from '../invoicing/driveState';
import { promoteAdvanceIfPaid } from '../invoicing/issue';
import { gstModelFromRows } from '../invoicing/model';
import {
  activityEvents,
  calendarEvents,
  clients,
  conversations,
  invoiceItems,
  invoices,
  leadNotes,
  leads,
  messages,
  payments,
  proposalItems,
  proposals,
  workspaces,
} from '../../db/schema';
import { enqueueAnalysisForMessage } from '../ai/runs';
import type { ValidatedCrmAction } from './schemas';

const date = (value: string | undefined | null) => (value ? new Date(value) : null);
const now = () => new Date();

async function recordActivity(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  workspaceId: string,
  actorId: string,
  entityType: string,
  entityId: string,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await tx.insert(activityEvents).values({
    id: randomUUID(),
    workspaceId,
    actorId,
    entityType,
    entityId,
    action,
    metadata,
  });
}

async function ensureConversation(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  workspaceId: string,
  leadId: string,
  timestamp: Date,
) {
  const conversationId = `conversation-${leadId}`;
  const [existing] = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.leadId, leadId)))
    .limit(1);
  if (existing) {
    await tx
      .update(conversations)
      .set({ lastMessageAt: timestamp, updatedAt: timestamp })
      .where(eq(conversations.id, existing.id));
    return existing.id;
  }
  await tx.insert(conversations).values({
    id: conversationId,
    workspaceId,
    leadId,
    lastMessageAt: timestamp,
  });
  return conversationId;
}

async function assertClient(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], workspaceId: string, clientId: string | undefined) {
  if (!clientId) return;
  const [client] = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.workspaceId, workspaceId)))
    .limit(1);
  if (!client) throw new Error('Client not found in this workspace');
}

async function assertLead(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], workspaceId: string, leadId: string | undefined) {
  if (!leadId) return;
  const [lead] = await tx
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId)))
    .limit(1);
  if (!lead) throw new Error('Lead not found in this workspace');
}

export async function applyCrmAction(workspaceId: string, actorId: string, action: ValidatedCrmAction) {
  if (action.type === 'settings.reportingCurrency') {
    await db
      .update(workspaces)
      .set({ reportingCurrency: action.payload.currency })
      .where(eq(workspaces.id, workspaceId));
    return { ok: true };
  }

  let queuedMessageId: string | null = null;
  let promotedInvoiceId: string | null = null;
  await db.transaction(async (tx) => {
    switch (action.type) {
      case 'lead.create': {
        const { lead, message } = action.payload;
        if (message.leadId !== lead.id) throw new Error('Message does not belong to lead');
        await tx.insert(leads).values({
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
          followUpAt: date(lead.followUpAt),
          createdAt: new Date(lead.createdAt),
          lastActivityAt: new Date(lead.lastActivityAt),
        });
        const conversationId = await ensureConversation(tx, workspaceId, lead.id, new Date(message.sentAt));
        await tx.insert(messages).values({
          id: message.id,
          workspaceId,
          leadId: lead.id,
          conversationId,
          direction: 'inbound',
          kind: 'text',
          body: message.body,
          source: lead.source,
          state: message.state,
          sentAt: new Date(message.sentAt),
        });
        await tx
          .update(conversations)
          .set({
            lastInboundAt: new Date(message.sentAt),
            unreadCount: sql`${conversations.unreadCount} + 1`,
            updatedAt: new Date(message.sentAt),
          })
          .where(eq(conversations.id, conversationId));
        await recordActivity(tx, workspaceId, actorId, 'lead', lead.id, 'lead.created', {
          source: lead.source,
        });
        queuedMessageId = message.id;
        return;
      }

      case 'lead.update': {
        const { id, patch } = action.payload;
        await assertLead(tx, workspaceId, id);
        await assertClient(tx, workspaceId, patch.clientId);
        await tx
          .update(leads)
          .set({
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.company !== undefined ? { company: patch.company } : {}),
            ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
            ...(patch.email !== undefined ? { email: patch.email } : {}),
            ...(patch.city !== undefined ? { city: patch.city } : {}),
            ...(patch.source !== undefined ? { source: patch.source } : {}),
            ...(patch.initialMessage !== undefined ? { initialMessage: patch.initialMessage } : {}),
            ...(patch.status !== undefined ? { status: patch.status } : {}),
            ...(patch.valueMinor !== undefined ? { valueMinor: patch.valueMinor } : {}),
            ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
            ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
            ...(patch.clientId !== undefined ? { clientId: patch.clientId } : {}),
            ...(patch.followUpAt !== undefined ? { followUpAt: date(patch.followUpAt) } : {}),
            lastActivityAt: now(),
          })
          .where(and(eq(leads.id, id), eq(leads.workspaceId, workspaceId)));
        await recordActivity(tx, workspaceId, actorId, 'lead', id, 'lead.updated');
        return;
      }

      case 'lead.move': {
        const { id, status } = action.payload;
        await assertLead(tx, workspaceId, id);
        await tx
          .update(leads)
          .set({ status, lastActivityAt: now() })
          .where(and(eq(leads.id, id), eq(leads.workspaceId, workspaceId)));
        await recordActivity(tx, workspaceId, actorId, 'lead', id, 'lead.stage_changed', { status });
        return;
      }

      case 'lead.convert': {
        const { leadId, client } = action.payload;
        const [lead] = await tx
          .select({ clientId: leads.clientId })
          .from(leads)
          .where(and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId)))
          .limit(1);
        if (!lead) throw new Error('Lead not found in this workspace');
        if (!lead.clientId) {
          await tx.insert(clients).values({
            id: client.id,
            workspaceId,
            name: client.name,
            company: client.company,
            email: client.email,
            phone: client.phone,
            city: client.city,
            notes: client.notes,
            createdAt: new Date(client.createdAt),
          });
          await tx
            .update(leads)
            .set({ clientId: client.id, status: 'accepted', lastActivityAt: now() })
            .where(and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId)));
        }
        await recordActivity(tx, workspaceId, actorId, 'lead', leadId, 'lead.converted', {
          clientId: lead.clientId ?? client.id,
        });
        return;
      }

      case 'reply.add': {
        const { message } = action.payload;
        const [lead] = await tx
          .select({ id: leads.id, source: leads.source })
          .from(leads)
          .where(and(eq(leads.id, message.leadId), eq(leads.workspaceId, workspaceId)))
          .limit(1);
        if (!lead) throw new Error('Lead not found in this workspace');
        const conversationId = await ensureConversation(tx, workspaceId, message.leadId, new Date(message.sentAt));
        await tx.insert(messages).values({
          id: message.id,
          workspaceId,
          leadId: message.leadId,
          conversationId,
          direction: 'outbound',
          kind: 'text',
          body: message.body,
          source: lead.source,
          state: message.state,
          sentAt: new Date(message.sentAt),
        });
        await tx
          .update(leads)
          .set({ lastActivityAt: new Date(message.sentAt) })
          .where(eq(leads.id, message.leadId));
        if (['sample', 'sent', 'delivered', 'read'].includes(message.state)) {
          await tx
            .update(conversations)
            .set({ lastOutboundAt: new Date(message.sentAt), updatedAt: new Date(message.sentAt) })
            .where(eq(conversations.id, conversationId));
        }
        await recordActivity(tx, workspaceId, actorId, 'lead', message.leadId, 'message.added', {
          mode: message.state === 'sample' ? 'sample' : 'live',
        });
        queuedMessageId = message.id;
        return;
      }

      case 'note.add': {
        const { note } = action.payload;
        await assertLead(tx, workspaceId, note.leadId);
        await tx.insert(leadNotes).values({
          id: note.id,
          workspaceId,
          leadId: note.leadId,
          body: note.body,
          createdAt: new Date(note.createdAt),
        });
        return;
      }

      case 'client.create': {
        const { client } = action.payload;
        await tx.insert(clients).values({
          id: client.id,
          workspaceId,
          name: client.name,
          company: client.company,
          email: client.email,
          phone: client.phone,
          city: client.city,
          notes: client.notes,
          createdAt: new Date(client.createdAt),
        });
        await recordActivity(tx, workspaceId, actorId, 'client', client.id, 'client.created');
        return;
      }

      case 'client.update': {
        const { id, patch } = action.payload;
        const [client] = await tx
          .select({ id: clients.id })
          .from(clients)
          .where(and(eq(clients.id, id), eq(clients.workspaceId, workspaceId)))
          .limit(1);
        if (!client) throw new Error('Client not found in this workspace');
        await tx
          .update(clients)
          .set({
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.company !== undefined ? { company: patch.company } : {}),
            ...(patch.email !== undefined ? { email: patch.email } : {}),
            ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
            ...(patch.city !== undefined ? { city: patch.city } : {}),
            ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          })
          .where(and(eq(clients.id, id), eq(clients.workspaceId, workspaceId)));
        return;
      }

      case 'proposal.create': {
        const { proposal } = action.payload;
        await assertLead(tx, workspaceId, proposal.leadId);
        await assertClient(tx, workspaceId, proposal.clientId);
        await tx.insert(proposals).values({
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
        });
        await tx.insert(proposalItems).values(
          proposal.lineItems.map((item, position) => ({
            id: item.id,
            proposalId: proposal.id,
            description: item.description,
            quantity: item.quantity,
            unitPriceMinor: item.unitPriceMinor,
            position,
          })),
        );
        await recordActivity(tx, workspaceId, actorId, 'proposal', proposal.id, 'proposal.created');
        return;
      }

      case 'proposal.update': {
        const { id, patch } = action.payload;
        await assertLead(tx, workspaceId, patch.leadId);
        await assertClient(tx, workspaceId, patch.clientId);
        const [existing] = await tx
          .select({ id: proposals.id })
          .from(proposals)
          .where(and(eq(proposals.id, id), eq(proposals.workspaceId, workspaceId)))
          .limit(1);
        if (!existing) throw new Error('Proposal not found in this workspace');
        await tx
          .update(proposals)
          .set({
            ...(patch.number !== undefined ? { number: patch.number } : {}),
            ...(patch.leadId !== undefined ? { leadId: patch.leadId ?? null } : {}),
            ...(patch.clientId !== undefined ? { clientId: patch.clientId ?? null } : {}),
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.status !== undefined ? { status: patch.status } : {}),
            ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
            ...(patch.issuedAt !== undefined ? { issuedAt: new Date(patch.issuedAt) } : {}),
            ...(patch.validUntil !== undefined ? { validUntil: new Date(patch.validUntil) } : {}),
            ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
            updatedAt: now(),
          })
          .where(and(eq(proposals.id, id), eq(proposals.workspaceId, workspaceId)));

        if (patch.lineItems) {
          await tx.delete(proposalItems).where(eq(proposalItems.proposalId, id));
          await tx.insert(proposalItems).values(
            patch.lineItems.map((item, position) => ({
              id: item.id,
              proposalId: id,
              description: item.description,
              quantity: item.quantity,
              unitPriceMinor: item.unitPriceMinor,
              position,
            })),
          );
        }

        if (patch.status === 'sent' || patch.status === 'accepted') {
          const [proposal] = await tx
            .select({ leadId: proposals.leadId })
            .from(proposals)
            .where(and(eq(proposals.id, id), eq(proposals.workspaceId, workspaceId)));
          if (proposal?.leadId) {
            await tx
              .update(leads)
              .set({
                status: patch.status === 'accepted' ? 'accepted' : 'proposal_sent',
                lastActivityAt: now(),
              })
              .where(and(eq(leads.id, proposal.leadId), eq(leads.workspaceId, workspaceId)));
          }
        }
        return;
      }

      case 'proposal.status': {
        const { id, status } = action.payload;
        const [proposal] = await tx
          .select({ id: proposals.id, leadId: proposals.leadId })
          .from(proposals)
          .where(and(eq(proposals.id, id), eq(proposals.workspaceId, workspaceId)))
          .limit(1);
        if (!proposal) throw new Error('Proposal not found in this workspace');
        await tx
          .update(proposals)
          .set({ status, updatedAt: now() })
          .where(eq(proposals.id, id));
        if (proposal.leadId && (status === 'sent' || status === 'accepted')) {
          await tx
            .update(leads)
            .set({ status: status === 'accepted' ? 'accepted' : 'proposal_sent', lastActivityAt: now() })
            .where(and(eq(leads.id, proposal.leadId), eq(leads.workspaceId, workspaceId)));
        }
        return;
      }

      case 'invoice.create': {
        const { invoice } = action.payload;
        await assertClient(tx, workspaceId, invoice.clientId);
        await assertLead(tx, workspaceId, invoice.leadId);
        await tx.insert(invoices).values({
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
        });
        await tx.insert(invoiceItems).values(
          invoice.lineItems.map((item, position) => ({
            id: item.id,
            invoiceId: invoice.id,
            description: item.description,
            quantity: item.quantity,
            unitPriceMinor: item.unitPriceMinor,
            position,
          })),
        );
        if (invoice.leadId) {
          await tx
            .update(leads)
            .set({ status: 'payment_due', lastActivityAt: now() })
            .where(and(eq(leads.id, invoice.leadId), eq(leads.workspaceId, workspaceId)));
        }
        await recordActivity(tx, workspaceId, actorId, 'invoice', invoice.id, 'invoice.created');
        return;
      }

      case 'invoice.update': {
        const { id, patch } = action.payload;
        await assertClient(tx, workspaceId, patch.clientId);
        await assertLead(tx, workspaceId, patch.leadId);
        const [existing] = await tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(and(eq(invoices.id, id), eq(invoices.workspaceId, workspaceId)))
          .limit(1);
        if (!existing) throw new Error('Invoice not found in this workspace');
        await tx
          .update(invoices)
          .set({
            ...(patch.number !== undefined ? { number: patch.number } : {}),
            ...(patch.clientId !== undefined ? { clientId: patch.clientId } : {}),
            ...(patch.leadId !== undefined ? { leadId: patch.leadId ?? null } : {}),
            ...(patch.proposalId !== undefined ? { proposalId: patch.proposalId ?? null } : {}),
            ...(patch.status !== undefined ? { status: patch.status } : {}),
            ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
            ...(patch.issuedAt !== undefined ? { issuedAt: new Date(patch.issuedAt) } : {}),
            ...(patch.dueAt !== undefined ? { dueAt: new Date(patch.dueAt) } : {}),
            ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
            updatedAt: now(),
          })
          .where(and(eq(invoices.id, id), eq(invoices.workspaceId, workspaceId)));

        if (patch.lineItems) {
          await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id));
          await tx.insert(invoiceItems).values(
            patch.lineItems.map((item, position) => ({
              id: item.id,
              invoiceId: id,
              description: item.description,
              quantity: item.quantity,
              unitPriceMinor: item.unitPriceMinor,
              position,
            })),
          );
        }
        return;
      }

      case 'payment.record': {
        const { payment } = action.payload;
        const [invoice] = await tx
          .select()
          .from(invoices)
          .where(and(eq(invoices.id, payment.invoiceId), eq(invoices.workspaceId, workspaceId)))
          .for('update')
          .limit(1);
        if (!invoice) throw new Error('Invoice not found in this workspace');
        const isRequest = invoice.docType === 'advance' && invoice.series === 'REF';
        if (invoice.status === 'draft' && !isRequest) throw new Error('Draft invoices cannot receive payments');
        if (invoice.status === 'draft' && isRequest) {
          await tx.update(invoices).set({ status: 'sent', updatedAt: now() }).where(eq(invoices.id, invoice.id));
        }

        if (invoice.cancelledAt) throw new Error('A cancelled invoice cannot receive payments');
        const items = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
        // A GST invoice is owed its tax-inclusive, rounded total, not just the line items.
        const gst = gstModelFromRows(invoice, items, 0);
        const total = gst
          ? gst.totals.grandMinor
          : items.reduce((sum, item) => sum + item.quantity * item.unitPriceMinor, 0);
        const [paidRow] = await tx
          .select({ paid: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::bigint` })
          .from(payments)
          .where(and(eq(payments.invoiceId, invoice.id), eq(payments.workspaceId, workspaceId)));
        const paid = Number(paidRow?.paid ?? 0);
        if (payment.amountMinor > total - paid) throw new Error('Payment exceeds the invoice balance');

        await tx.insert(payments).values({
          id: payment.id,
          workspaceId,
          invoiceId: invoice.id,
          amountMinor: payment.amountMinor,
          currency: invoice.currency,
          receivedAt: new Date(payment.receivedAt),
          method: payment.method,
          note: payment.note,
        });
        const fullyPaid = paid + payment.amountMinor >= total;
        // The first full payment of an advance request is what gives it its ADV number.
        if (await promoteAdvanceIfPaid(tx, workspaceId, invoice, fullyPaid, new Date(payment.receivedAt))) {
          promotedInvoiceId = invoice.id;
        }
        if (invoice.leadId) {
          await tx
            .update(leads)
            .set({ status: fullyPaid ? 'paid' : 'payment_due', lastActivityAt: now() })
            .where(and(eq(leads.id, invoice.leadId), eq(leads.workspaceId, workspaceId)));
        }
        await recordActivity(tx, workspaceId, actorId, 'payment', payment.id, 'payment.recorded', {
          invoiceId: invoice.id,
          amountMinor: payment.amountMinor,
          currency: invoice.currency,
        });
        return;
      }

      case 'event.create': {
        const { event } = action.payload;
        await assertLead(tx, workspaceId, event.leadId);
        await assertClient(tx, workspaceId, event.clientId);
        await tx.insert(calendarEvents).values({
          id: event.id,
          workspaceId,
          title: event.title,
          startsAt: new Date(event.startsAt),
          endsAt: new Date(event.endsAt),
          type: event.type,
          leadId: event.leadId ?? null,
          clientId: event.clientId ?? null,
          href: event.href ?? null,
        });
        return;
      }
    }
  });

  if (promotedInvoiceId) await markDriveDirty(workspaceId, promotedInvoiceId).catch(() => undefined);

  if (queuedMessageId) {
    await enqueueAnalysisForMessage(workspaceId, queuedMessageId, 'crm_message').catch(
      () => undefined,
    );
  }
  return { ok: true };
}
