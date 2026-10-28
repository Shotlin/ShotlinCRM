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
  // 'outbound' = typed on the linked phone itself, not sent from the CRM.
  direction?: 'inbound' | 'outbound';
  // Backfilled history: no unread count, no AI analysis, no per-message realtime event.
  historical?: boolean;
};

const normalizePhone = (value: string) => value.replace(/\D/g, '');

// A name that is only the phone number was auto-filled and can be replaced by a real one.
export const isPlaceholderName = (name: string) => /^\+?[\d\s()-]+$/.test(name.trim());

export async function ingestInboundMessage(envelope: InboundEnvelope) {
  const outbound = envelope.direction === 'outbound';
  const historical = envelope.historical === true;
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
      .select({ id: leads.id, name: leads.name, phone: leads.phone, inPipeline: leads.inPipeline })
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
        // For phone-typed messages pushName is our own display name, not the contact's.
        name: (!outbound && envelope.pushName?.trim()) || `+${wantedPhone}`,
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
        // A WhatsApp chat is not a pipeline lead until someone adds it.
        inPipeline: false,
        createdAt: timestamp,
        lastActivityAt: timestamp,
      });
    } else {
      const realName = !outbound ? envelope.pushName?.trim() : undefined;
      await tx
        .update(leads)
        .set({
          lastActivityAt: sql`GREATEST(${leads.lastActivityAt}, ${timestamp.toISOString()}::timestamptz)`,
          ...(realName && isPlaceholderName(existingLead.name) ? { name: realName } : {}),
        })
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
    const stamp = timestamp.toISOString();
    if (existingConversation) {
      await tx
        .update(conversations)
        .set({
          remoteJid: envelope.remoteJid,
          lastMessageAt: sql`GREATEST(${conversations.lastMessageAt}, ${stamp}::timestamptz)`,
          ...(outbound
            ? { lastOutboundAt: sql`GREATEST(${conversations.lastOutboundAt}, ${stamp}::timestamptz)` }
            : {
                lastInboundAt: sql`GREATEST(${conversations.lastInboundAt}, ${stamp}::timestamptz)`,
                ...(historical ? {} : { unreadCount: sql`${conversations.unreadCount} + 1` }),
              }),
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
        ...(outbound ? { lastOutboundAt: timestamp } : { lastInboundAt: timestamp }),
        unreadCount: outbound || historical ? 0 : 1,
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
        direction: outbound ? 'outbound' : 'inbound',
        kind: envelope.kind,
        body: envelope.body,
        providerMessageId: envelope.providerMessageId,
        source: 'whatsapp',
        state: outbound ? 'sent' : 'read',
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

  if (!result.duplicate && !historical) {
    await publishChange(
      envelope.workspaceId,
      outbound ? 'message.sent' : 'message.received',
      result.leadId ?? undefined,
    );
    if (result.messageId && !outbound) {
      await enqueueAnalysisForMessage(
        envelope.workspaceId,
        result.messageId,
        'message_ingested',
      ).catch(() => undefined);
    }
  }
  return result;
}

// Names from the phone's address book (`saved`) or WhatsApp profile names. Only auto-filled
// names are replaced; a pipeline lead someone renamed by hand is left alone.
export async function applyContactNames(
  workspaceId: string,
  entries: { phone: string; name: string; saved: boolean }[],
) {
  if (!entries.length) return 0;
  const rows = await db
    .select({ id: leads.id, name: leads.name, phone: leads.phone, inPipeline: leads.inPipeline })
    .from(leads)
    .where(eq(leads.workspaceId, workspaceId));
  const byPhone = new Map(rows.map((row) => [normalizePhone(row.phone), row]));
  let updated = 0;
  for (const entry of entries) {
    const name = entry.name.trim();
    const lead = byPhone.get(normalizePhone(entry.phone));
    if (!lead || !name || isPlaceholderName(name) || name === lead.name) continue;
    const replaceable = isPlaceholderName(lead.name) || (entry.saved && !lead.inPipeline);
    if (!replaceable) continue;
    await db
      .update(leads)
      .set({ name })
      .where(and(eq(leads.id, lead.id), eq(leads.workspaceId, workspaceId)));
    lead.name = name;
    updated += 1;
  }
  if (updated) await publishChange(workspaceId, 'contacts.updated');
  return updated;
}
