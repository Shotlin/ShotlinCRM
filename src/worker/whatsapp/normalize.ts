import type { WAMessage } from '@whiskeysockets/baileys';

export type NormalizedMessage = {
  providerMessageId: string;
  remoteJid: string;
  phone: string;
  pushName?: string;
  sentAt: Date;
  fromMe: boolean;
  kind: 'text' | 'image' | 'video' | 'audio' | 'document';
  body: string;
  mimeType?: string;
  filename?: string;
};

export function normalizeWhatsAppMessage(raw: WAMessage): NormalizedMessage | null {
  const remoteJid = raw.key.remoteJid;
  if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.endsWith('@g.us')) return null;

  const message = unwrapMessage(raw.message);
  if (!message) return null;

  let kind: NormalizedMessage['kind'] = 'text';
  let body = '';
  let mimeType: string | undefined;
  let filename: string | undefined;

  if (message.conversation) {
    body = message.conversation;
  } else if (message.extendedTextMessage?.text) {
    body = message.extendedTextMessage.text;
  } else if (message.imageMessage) {
    kind = 'image';
    body = message.imageMessage.caption ?? '';
    mimeType = message.imageMessage.mimetype ?? 'image/jpeg';
  } else if (message.videoMessage) {
    kind = 'video';
    body = message.videoMessage.caption ?? '';
    mimeType = message.videoMessage.mimetype ?? 'video/mp4';
  } else if (message.audioMessage) {
    kind = 'audio';
    mimeType = message.audioMessage.mimetype ?? 'audio/ogg';
  } else if (message.documentMessage) {
    kind = 'document';
    body = message.documentMessage.caption ?? '';
    mimeType = message.documentMessage.mimetype ?? 'application/octet-stream';
    filename = message.documentMessage.fileName ?? 'document';
  } else {
    return null;
  }

  const digits = remoteJid.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') ?? '';
  if (!digits) return null;
  const timestamp = Number(raw.messageTimestamp ?? 0);

  return {
    providerMessageId: raw.key.id ?? `${remoteJid}-${timestamp}`,
    remoteJid,
    phone: digits,
    pushName: raw.pushName ?? undefined,
    sentAt: timestamp ? new Date(timestamp * 1000) : new Date(),
    fromMe: raw.key.fromMe === true,
    kind,
    body,
    mimeType,
    filename,
  };
}

function unwrapMessage(message: WAMessage['message']): WAMessage['message'] | undefined {
  if (!message) return undefined;
  if (message.ephemeralMessage?.message) return unwrapMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return unwrapMessage(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return unwrapMessage(message.viewOnceMessageV2.message);
  if (message.documentWithCaptionMessage?.message) {
    return unwrapMessage(message.documentWithCaptionMessage.message);
  }
  return message;
}
