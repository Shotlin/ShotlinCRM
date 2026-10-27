import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../../db/client';
import {
  conversations,
  leads,
  messageMedia,
  messages,
} from '../../db/schema';
import { publishChange } from '../../realtime';
import type { StoredMedia } from '../../storage';
import { enqueueAnalysisForMessage } from '../ai/runs';

export type InboundEnvelope = {
  workspaceId: string;
  providerMessageId: string;
  remoteJid: string;
  phone: string;
  pushName?: string;
  sentAt: Date;
  kind: 'text' | 'image' | 'video' | 'audio' | 'document';
  body: string;
  media?: StoredMedia & { filename?: string };
};

const normalizePhone = (value: string) => value.replace(/\D/g, '');

export async function ingestInboundMessage(envelope: InboundEnvelope) {
  const existingMessage = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.workspaceId, envelope.workspaceId),
        eq(messages.providerMessageId, envelope.providerMessageId),
      ),
    )
    .limit(1);
  if (existingMessage.length) return { duplicate: true, leadId: null, messageId: null };

  const result = await db.transaction(async (tx) => {
    const candidateLeads = await tx
      .select({ id: leads.id, name: leads.name, phone: leads.phone })
      .from(leads)
      .where(eq(leads.workspaceId, envelope.workspaceId));
    const wantedPhone = normalizePhone(envelope.phone);
    const existingLead = candidateLeads.find((lead) => normalizePhone(lead.phone) === wantedPhone);

    const leadId = existingLead?.id ?? randomUUID();
    const timestamp = envelope.sentAt;
    if (!existingLead) {
      await tx.insert(leads).values({
        id: leadId,
        workspaceId: envelope.workspaceId,
        name: envelope.pushName?.trim() || `+${wantedPhone}`,
        company: '',
        phone: `+${wantedPhone}`,
        email: '',
        city: '',
        source: 'whatsapp',
        initialMessage: envelope.body || `Sent ${envelope.kind === 'text' ? 'a message' : `a ${envelope.kind}`}`,
        status: 'new',
        valueMinor: 0,
        currency: 'INR',
        ownerInitials: 'SR',
        tags: [],
        createdAt: timestamp,
        lastActivityAt: timestamp,
      });
    } else {
      await tx
        .update(leads)
        .set({ lastActivityAt: timestamp })
        .where(and(eq(leads.id, leadId), eq(leads.workspaceId, envelope.workspaceId)));
    }

    const [existingConversation] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.workspaceId, envelope.workspaceId),
          eq(conversations.leadId, leadId),
        ),
      )
      .limit(1);

    const conversationId = existingConversation?.id ?? randomUUID();
    if (existingConversation) {
      await tx
        .update(conversations)
        .set({
          remoteJid: envelope.remoteJid,
          lastMessageAt: timestamp,
          lastInboundAt: timestamp,
          unreadCount: sql`${conversations.unreadCount} + 1`,
          updatedAt: timestamp,
        })
        .where(eq(conversations.id, conversationId));
    } else {
      await tx.insert(conversations).values({
        id: conversationId,
        workspaceId: envelope.workspaceId,
        leadId,
        remoteJid: envelope.remoteJid,
        lastMessageAt: timestamp,
        lastInboundAt: timestamp,
        unreadCount: 1,
      });
    }

    const messageId = randomUUID();
    const inserted = await tx
      .insert(messages)
      .values({
        id: messageId,
        workspaceId: envelope.workspaceId,
        leadId,
        conversationId,
        direction: 'inbound',
        kind: envelope.kind,
        body: envelope.body,
        providerMessageId: envelope.providerMessageId,
        source: 'whatsapp',
        state: 'read',
        sentAt: timestamp,
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });

    if (!inserted.length) return { duplicate: true, leadId, messageId: null };

    if (envelope.media) {
      await tx.insert(messageMedia).values({
        id: randomUUID(),
        workspaceId: envelope.workspaceId,
        messageId,
        objectKey: envelope.media.objectKey,
        mimeType: envelope.media.mimeType,
        mediaKind: envelope.kind,
        filename: envelope.media.filename,
        sizeBytes: envelope.media.sizeBytes,
        checksum: envelope.media.checksum,
        state: 'ready',
      });
    }

    return { duplicate: false, leadId, messageId };
  });

  if (!result.duplicate) {
    await publishChange(envelope.workspaceId, 'message.received', result.leadId ?? undefined);
    if (result.messageId) {
      await enqueueAnalysisForMessage(
        envelope.workspaceId,
        result.messageId,
        'message_ingested',
      ).catch(() => undefined);
    }
  }
  return result;
}
