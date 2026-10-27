import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../../db/client';
import {
  conversations,
  leads,
  messageMedia,
  messageTemplates,
  messages,
  outboundJobs,
  whatsappConnections,
} from '../../db/schema';
import { queueOutboundJob } from '../../queues';
import { publishChange } from '../../realtime';
import { getPrivateMedia } from '../../storage';
import { renderTemplate } from '../templates/render';

const normalizePhone = (value: string) => value.replace(/\D/g, '');

export type SendMessageInput = {
  workspaceId: string;
  leadId: string;
  body?: string;
  templateId?: string;
  clientIdempotencyKey: string;
  mediaId?: string;
};

export async function sendManualMessage(input: SendMessageInput) {
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, input.leadId), eq(leads.workspaceId, input.workspaceId)))
    .limit(1);
  if (!lead) throw new Error('Lead not found in this workspace');
  const phone = normalizePhone(lead.phone);
  if (phone.length < 7 || phone.length > 15) throw new Error('The lead needs a valid phone number');

  const [connection] = await db
    .select({ state: whatsappConnections.state })
    .from(whatsappConnections)
    .where(eq(whatsappConnections.workspaceId, input.workspaceId))
    .limit(1);
  if (connection?.state !== 'connected') {
    throw new Error('Connect your WhatsApp linked device before sending messages');
  }

  const existing = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.workspaceId, input.workspaceId),
        eq(messages.clientIdempotencyKey, input.clientIdempotencyKey),
      ),
    )
    .limit(1);
  if (existing[0]) return { messageId: existing[0].id, duplicate: true };

  let body = input.body?.trim() ?? '';
  if (input.templateId) {
    const [template] = await db
      .select()
      .from(messageTemplates)
      .where(
        and(
          eq(messageTemplates.id, input.templateId),
          eq(messageTemplates.workspaceId, input.workspaceId),
          isNull(messageTemplates.archivedAt),
        ),
      )
      .limit(1);
    if (!template) throw new Error('Message template not found');
    body = renderTemplate(template.body, {
      name: lead.name,
      company: lead.company,
      followUpDate: lead.followUpAt?.toLocaleDateString('en-IN') ?? '',
    });
  }
  if (!body && !input.mediaId) throw new Error('Write a message or select a template');
  if (body.length > 8_000) throw new Error('Message is too long');

  let outboundMedia:
    | { id: string; objectKey: string; mimeType: string; kind: string; filename: string | null }
    | undefined;
  if (input.mediaId) {
    const [media] = await db
      .select()
      .from(messageMedia)
      .where(and(eq(messageMedia.id, input.mediaId), eq(messageMedia.workspaceId, input.workspaceId)))
      .limit(1);
    if (!media) throw new Error('Media not found');
    outboundMedia = {
      id: media.id,
      objectKey: media.objectKey,
      mimeType: media.mimeType,
      kind: media.mediaKind,
      filename: media.filename,
    };
  }

  const messageId = randomUUID();
  await db.transaction(async (tx) => {
    const conversationId = `conversation-${lead.id}`;
    await tx
      .insert(conversations)
      .values({
        id: conversationId,
        workspaceId: input.workspaceId,
        leadId: lead.id,
        lastMessageAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [conversations.workspaceId, conversations.leadId],
        set: { lastMessageAt: new Date(), updatedAt: new Date() },
      });

    await tx.insert(messages).values({
      id: messageId,
      workspaceId: input.workspaceId,
      leadId: lead.id,
      conversationId,
      direction: 'outbound',
      kind: outboundMedia?.kind ?? 'text',
      body,
      clientIdempotencyKey: input.clientIdempotencyKey,
      source: 'whatsapp',
      state: 'queued',
      sentAt: new Date(),
    });

    if (outboundMedia) {
      await tx.update(messageMedia).set({ messageId }).where(eq(messageMedia.id, outboundMedia.id));
    }

    await tx.insert(outboundJobs).values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      messageId,
    });
    await tx.update(leads).set({ lastActivityAt: new Date() }).where(eq(leads.id, lead.id));
  });

  try {
    await queueOutboundJob(messageId, input.workspaceId);
  } catch {
    await db.update(messages).set({ state: 'failed' }).where(eq(messages.id, messageId));
    await db
      .update(outboundJobs)
      .set({ state: 'failed', lastErrorCode: 'queue_unavailable' })
      .where(eq(outboundJobs.messageId, messageId));
    throw new Error('The outbound message queue is unavailable');
  }

  await publishChange(input.workspaceId, 'message.queued', lead.id);
  return { messageId, duplicate: false, body };
}

export async function loadOutboundPayload(workspaceId: string, messageId: string) {
  const [row] = await db
    .select({ message: messages, lead: leads, job: outboundJobs })
    .from(messages)
    .innerJoin(leads, eq(leads.id, messages.leadId))
    .innerJoin(outboundJobs, eq(outboundJobs.messageId, messages.id))
    .where(and(eq(messages.id, messageId), eq(messages.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw new Error('Outbound message not found');

  const [media] = await db
    .select()
    .from(messageMedia)
    .where(eq(messageMedia.messageId, messageId))
    .limit(1);

  return {
    ...row,
    media: media
      ? {
          buffer: await getPrivateMedia(media.objectKey),
          mimeType: media.mimeType,
          filename: media.filename ?? undefined,
          kind: media.mediaKind,
        }
      : undefined,
  };
}
