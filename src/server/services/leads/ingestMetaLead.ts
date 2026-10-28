import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { fetchMetaAttribution, fetchMetaLead } from '../../integrations/meta/graph';
import { mapMetaLeadFields } from '../../integrations/meta/fields';
import { db } from '../../db/client';
import {
  conversations,
  leadAttributions,
  leads,
  messages,
  metaConnections,
  metaLeadEvents,
} from '../../db/schema';
import { publishChange } from '../../realtime';
import { decryptSecret } from '../../security/envelope';
import { enqueueAnalysisForMessage } from '../ai/runs';

const normalizePhone = (value: string) => value.replace(/\D/g, '');

export async function ingestMetaLead(workspaceId: string, leadgenId: string) {
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`meta:${workspaceId}:${leadgenId}`}))`,
    );
    const [event] = await tx
      .select()
      .from(metaLeadEvents)
      .where(
        and(
          eq(metaLeadEvents.workspaceId, workspaceId),
          eq(metaLeadEvents.leadgenId, leadgenId),
        ),
      )
      .for('update')
      .limit(1);
    if (!event) throw new Error('Meta lead event not found');
    if (event.processingState === 'processed') return { duplicate: true, messageId: null };

    const [connection] = await tx
      .select()
      .from(metaConnections)
      .where(eq(metaConnections.workspaceId, workspaceId))
      .limit(1);
    if (!connection) throw new Error('Meta connection not found');

    const accessToken = decryptSecret(connection.encryptedAccessToken);
    const payload = await fetchMetaLead(leadgenId, accessToken);
    const attribution = await fetchMetaAttribution(payload, connection.pageId, accessToken);
    const mapped = mapMetaLeadFields(payload, attribution.adName ?? attribution.formId);
    const createdAt = payload.created_time ? new Date(payload.created_time) : new Date();
    const phone = mapped.phone ? `+${normalizePhone(mapped.phone)}` : '';
    const messageId = randomUUID();
    let leadId: string = randomUUID();
    let conversationId = `conversation-${leadId}`;
    let existingConversation = false;
    let reuseChat = false;
    if (phone) {
      // The same number may already be a plain WhatsApp chat: promote it instead of
      // creating a second thread for the same person.
      const [chat] = await tx
        .select({ id: leads.id })
        .from(leads)
        .where(
          and(
            eq(leads.workspaceId, workspaceId),
            eq(leads.inPipeline, false),
            sql`regexp_replace(${leads.phone}, '[^0-9]', '', 'g') = ${normalizePhone(phone)}`,
          ),
        )
        .limit(1);
      if (chat) {
        leadId = chat.id;
        reuseChat = true;
        const [conversation] = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.leadId, leadId)))
          .limit(1);
        if (conversation) {
          conversationId = conversation.id;
          existingConversation = true;
        }
      }
    }

    const leadValues = {
      id: leadId,
      workspaceId,
      name: mapped.name,
      company: mapped.company,
      phone,
      email: mapped.email,
      city: mapped.city,
      source: 'meta',
      initialMessage: mapped.initialMessage,
      status: 'new',
      valueMinor: 0,
      currency: 'INR',
      ownerInitials: 'SR',
      tags: ['Meta lead', attribution.campaignName, attribution.adName].filter(
        (tag): tag is string => Boolean(tag),
      ),
      createdAt,
      lastActivityAt: createdAt,
    };
    if (reuseChat) {
      const patch: Partial<typeof leadValues> = { ...leadValues };
      delete patch.id;
      delete patch.workspaceId;
      delete patch.createdAt;
      await tx
        .update(leads)
        .set({ ...patch, inPipeline: true })
        .where(and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId)));
    } else {
      await tx.insert(leads).values(leadValues);
    }

    await tx.insert(leadAttributions).values({
      id: randomUUID(),
      workspaceId,
      leadId,
      ...attribution,
    });

    if (existingConversation) {
      await tx
        .update(conversations)
        .set({
          lastMessageAt: createdAt,
          lastInboundAt: createdAt,
          unreadCount: sql`${conversations.unreadCount} + 1`,
          updatedAt: createdAt,
        })
        .where(eq(conversations.id, conversationId));
    } else {
      await tx.insert(conversations).values({
        id: conversationId,
        workspaceId,
        leadId,
        lastMessageAt: createdAt,
        lastInboundAt: createdAt,
        unreadCount: 1,
      });
    }
    await tx.insert(messages).values({
      id: messageId,
      workspaceId,
      leadId,
      conversationId,
      direction: 'inbound',
      kind: 'text',
      body: mapped.initialMessage,
      source: 'meta',
      state: 'read',
      sentAt: createdAt,
    });

    await tx
      .update(metaLeadEvents)
      .set({ processingState: 'processed', processedAt: new Date(), lastError: null })
      .where(eq(metaLeadEvents.id, event.id));
    return { duplicate: false, messageId };
  });

  if (!result.duplicate) {
    await publishChange(workspaceId, 'meta.lead_created');
    if (result.messageId) {
      await enqueueAnalysisForMessage(workspaceId, result.messageId, 'meta_lead_ingested').catch(
        () => undefined,
      );
    }
  }
  return result;
}

export async function markMetaEventFailed(workspaceId: string, leadgenId: string, error: unknown) {
  await db
    .update(metaLeadEvents)
    .set({
      processingState: 'error',
      lastError: error instanceof Error ? error.message.slice(0, 500) : 'Meta lead ingestion failed',
    })
    .where(
      and(
        eq(metaLeadEvents.workspaceId, workspaceId),
        eq(metaLeadEvents.leadgenId, leadgenId),
      ),
    );
}
