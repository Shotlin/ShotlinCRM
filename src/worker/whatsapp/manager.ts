import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type Contact,
  type WASocket,
  type WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { and, eq, inArray } from 'drizzle-orm';
import pino from 'pino';
import { db } from '../../server/db/client';
import { whatsappConnections } from '../../server/db/schema';
import { encryptSecret } from '../../server/security/envelope';
import { applyContactNames, ingestInboundMessage } from '../../server/services/conversations/ingest';
import { publishChange } from '../../server/realtime';
import { putPrivateMedia } from '../../server/storage';
import { messages } from '../../server/db/schema';
import { createBaileysAuthState, deleteBaileysAuthState } from './authState';
import { normalizeWhatsAppMessage } from './normalize';

const logger = pino({
  level: process.env.BAILEYS_LOG_LEVEL ?? 'warn',
  redact: ['phone', 'remoteJid', 'body', '*.phone', '*.remoteJid', '*.body'],
});

const mockTransport = () =>
  process.env.NODE_ENV !== 'production' && process.env.WHATSAPP_TRANSPORT === 'mock';

type ConnectionRecord = typeof whatsappConnections.$inferSelect;

type ActiveConnection = {
  socket: WASocket;
  generation: number;
  attempts: number;
  reconnectTimer?: NodeJS.Timeout;
};

export class WhatsAppManager {
  private connections = new Map<string, ActiveConnection>();
  private stopping = false;

  async start(workspaceId: string) {
    const [connection] = await db
      .select()
      .from(whatsappConnections)
      .where(eq(whatsappConnections.workspaceId, workspaceId))
      .limit(1);
    if (!connection) throw new Error('WhatsApp connection not configured');

    const existing = this.connections.get(workspaceId);
    if (existing && existing.generation === connection.generation) return;

    if (existing) {
      if (existing.reconnectTimer) clearTimeout(existing.reconnectTimer);
      existing.socket.end(undefined);
      this.connections.delete(workspaceId);
    }
    if (this.stopping) return;

    await this.updateConnection(connection, connection.generation, {
      state: 'connecting',
      lastError: null,
    });

    const auth = await createBaileysAuthState(connection.id);
    let version: [number, number, number] | undefined;
    try {
      version = (await fetchLatestBaileysVersion()).version;
    } catch {
      logger.warn('Could not fetch the latest Baileys version; using the bundled default');
    }

    const socket = makeWASocket({
      ...(version ? { version } : {}),
      auth: {
        creds: auth.state.creds,
        keys: makeCacheableSignalKeyStore(auth.state.keys, logger),
      },
      printQRInTerminal: false,
      generateHighQualityLinkPreview: false,
      // A "Desktop" companion asks the phone for older chats while pairing.
      syncFullHistory: true,
      markOnlineOnConnect: false,
      logger,
      browser: ['Shotlin CRM', 'Desktop', '1.0.0'],
    });

    const active: ActiveConnection = {
      socket,
      generation: connection.generation,
      attempts: 0,
    };
    this.connections.set(workspaceId, active);

    socket.ev.on('creds.update', () => {
      auth.saveCreds().catch((error) => logger.error({ error }, 'Failed to save WhatsApp credentials'));
    });

    socket.ev.on('connection.update', (update) => {
      void this.handleConnectionUpdate(workspaceId, active, update, connection);
    });

    socket.ev.on('messages.upsert', ({ messages: incoming, type }) => {
      if (type !== 'notify') return;
      for (const raw of incoming) {
        const ingest = () =>
          this.enqueue(() => this.handleIncomingMessage(connection, socket, raw)).catch((error) =>
            logger.error({ error }, 'Failed to ingest WhatsApp message'),
          );
        // Messages typed on the phone: give a CRM-sent message's job time to store its id first.
        if (raw.key.fromMe) setTimeout(() => void ingest(), 2_500);
        else void ingest();
      }
    });

    socket.ev.on('messaging-history.set', ({ messages: history, contacts }) => {
      void this.enqueue(async () => {
        await this.handleHistory(connection, socket, history);
        await this.handleContacts(connection, socket, contacts);
      }).catch((error) => logger.error({ error }, 'Failed to import WhatsApp history'));
    });

    const onContacts = (contacts: Partial<Contact>[]) => {
      void this.enqueue(() => this.handleContacts(connection, socket, contacts)).catch((error) =>
        logger.error({ error }, 'Failed to apply WhatsApp contact names'),
      );
    };
    socket.ev.on('contacts.upsert', onContacts);
    socket.ev.on('contacts.update', onContacts);

    socket.ev.on('messages.update', (updates) => {
      void this.handleMessageUpdates(connection, updates);
    });
  }

  private async handleConnectionUpdate(
    workspaceId: string,
    active: ActiveConnection,
    update: { connection?: string; qr?: string; lastDisconnect?: { error?: Error } },
    connection: ConnectionRecord,
  ) {
    if (this.connections.get(workspaceId) !== active) return;

    if (update.qr) {
      await this.updateConnection(connection, active.generation, {
        state: 'connecting',
        qrCiphertext: encryptSecret(update.qr),
        qrExpiresAt: new Date(Date.now() + 60_000),
      });
      await publishChange(workspaceId, 'whatsapp.qr');
    }

    if (update.connection === 'open') {
      active.attempts = 0;
      await this.updateConnection(connection, active.generation, {
        state: 'connected',
        phone: active.socket.user?.id?.split(':')[0]?.split('@')[0] ?? null,
        connectedAt: new Date(),
        qrCiphertext: null,
        qrExpiresAt: null,
        lastError: null,
      });
      logger.info({ workspaceId }, 'WhatsApp linked device connected');
      await publishChange(workspaceId, 'whatsapp.connected');
    }

    if (update.connection === 'close') {
      this.connections.delete(workspaceId);
      const statusCode = new Boom(update.lastDisconnect?.error)?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        await deleteBaileysAuthState(connection.id);
        await this.updateConnection(connection, active.generation, {
          state: 'logged_out',
          qrCiphertext: null,
          qrExpiresAt: null,
          lastError: 'The phone removed this linked device.',
        });
        await publishChange(workspaceId, 'whatsapp.logged_out');
        return;
      }

      active.attempts += 1;
      if (active.attempts <= 5 && !this.stopping) {
        const delay = Math.min(1_000 * 2 ** active.attempts, 60_000);
        await this.updateConnection(connection, active.generation, {
          state: 'connecting',
          lastError: 'Reconnecting to WhatsApp',
        });
        active.reconnectTimer = setTimeout(() => {
          void this.start(workspaceId).catch((error) =>
            logger.error({ error }, 'WhatsApp reconnect failed'),
          );
        }, delay);
      } else {
        await this.updateConnection(connection, active.generation, {
          state: 'error',
          lastError: 'WhatsApp disconnected after repeated retries.',
        });
      }
      await publishChange(workspaceId, 'whatsapp.disconnected');
    }
  }

  // One ingest at a time keeps message order and stops two messages from a new
  // contact creating two leads.
  private ingestQueue: Promise<unknown> = Promise.resolve();

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.ingestQueue.then(job, job);
    this.ingestQueue = next.catch(() => undefined);
    return next;
  }

  // Chats can be addressed by an opaque "@lid" id; the CRM needs the phone number.
  private async resolvePhoneJid(socket: WASocket, raw: WAMessage): Promise<string | undefined> {
    const jid = raw.key.remoteJid;
    if (!jid || !jid.endsWith('@lid')) return jid ?? undefined;
    const alt = raw.key.remoteJidAlt;
    if (alt?.endsWith('@s.whatsapp.net')) return alt;
    const pn = await socket.signalRepository.lidMapping.getPNForLID(jid).catch(() => null);
    return pn ? (pn.includes('@') ? pn : `${pn}@s.whatsapp.net`) : undefined;
  }

  // Saved address-book names and profile names replace the bare phone numbers.
  private async handleContacts(
    connection: ConnectionRecord,
    socket: WASocket,
    contacts: Partial<Contact>[] | undefined,
  ) {
    if (!contacts?.length) return;
    const entries: { phone: string; name: string; saved: boolean }[] = [];
    for (const contact of contacts) {
      const name = contact.name || contact.verifiedName || contact.notify;
      if (!contact.id || !name || contact.id.endsWith('@g.us') || contact.id === 'status@broadcast') continue;
      let phoneJid = contact.id.endsWith('@s.whatsapp.net') ? contact.id : contact.phoneNumber;
      if (!phoneJid && contact.id.endsWith('@lid')) {
        phoneJid =
          (await socket.signalRepository.lidMapping.getPNForLID(contact.id).catch(() => null)) ?? undefined;
      }
      const digits = phoneJid?.split('@')[0]?.split(':')[0]?.replace(/\D/g, '');
      if (digits) entries.push({ phone: digits, name, saved: Boolean(contact.name) });
    }
    const updated = await applyContactNames(connection.workspaceId, entries);
    if (updated) logger.warn({ received: contacts.length, named: updated }, 'WhatsApp contact names applied');
  }

  private async handleHistory(connection: ConnectionRecord, socket: WASocket, history: WAMessage[]) {
    const days = Number(process.env.WHATSAPP_HISTORY_DAYS ?? 90);
    const cutoff = Date.now() - days * 86_400_000;
    const seconds = (raw: WAMessage) => Number(raw.messageTimestamp ?? 0);
    const recent = history
      .filter((raw) => seconds(raw) * 1000 >= cutoff)
      .sort((a, b) => seconds(a) - seconds(b));
    let stored = 0;
    for (const raw of recent) {
      try {
        if (await this.handleIncomingMessage(connection, socket, raw, true)) stored += 1;
      } catch (error) {
        logger.warn({ error }, 'Skipped a history message that could not be stored');
      }
    }
    logger.warn({ received: history.length, inWindow: recent.length, stored }, 'WhatsApp history imported');
    await publishChange(connection.workspaceId, 'history.synced');
  }

  private async handleIncomingMessage(
    connection: ConnectionRecord,
    socket: WASocket,
    raw: WAMessage,
    historical = false,
  ): Promise<boolean> {
    const phoneJid = await this.resolvePhoneJid(socket, raw);
    const normalized = normalizeWhatsAppMessage(raw, phoneJid);
    if (!normalized) {
      if (raw.message && raw.key.remoteJid?.endsWith('@lid') && !phoneJid) {
        logger.warn('Skipped a message from a contact whose phone number is not known yet');
      }
      return false;
    }

    let storedMedia;
    if (!historical && normalized.mimeType && normalized.kind !== 'text') {
      try {
        const buffer = await downloadMediaMessage(raw, 'buffer', {}, {
          logger,
          reuploadRequest: socket.updateMediaMessage,
        });
        storedMedia = await putPrivateMedia({
          workspaceId: connection.workspaceId,
          buffer: Buffer.from(buffer),
          mimeType: normalized.mimeType,
          filename: normalized.filename,
        });
      } catch (error) {
        logger.warn({ error, kind: normalized.kind }, 'WhatsApp media download failed');
      }
    }

    const result = await ingestInboundMessage({
      workspaceId: connection.workspaceId,
      providerMessageId: normalized.providerMessageId,
      remoteJid: normalized.remoteJid,
      phone: normalized.phone,
      pushName: normalized.pushName,
      sentAt: normalized.sentAt,
      kind: normalized.kind,
      // History is imported as text only; media is not re-downloaded.
      body: historical && normalized.kind !== 'text' && !normalized.body ? `[${normalized.kind}]` : normalized.body,
      media: storedMedia ? { ...storedMedia, filename: normalized.filename } : undefined,
      direction: normalized.fromMe ? 'outbound' : 'inbound',
      historical,
    });
    return !result.duplicate;
  }

  private async handleMessageUpdates(
    connection: ConnectionRecord,
    updates: { key: { id?: string | null }; update?: { status?: number | null } }[],
  ) {
    const statusNames = ['failed', 'sent', 'sent', 'delivered', 'read', 'read'] as const;
    for (const update of updates) {
      if (!update.key.id || update.update?.status == null) continue;
      const state = statusNames[update.update.status] ?? 'sent';
      await db
        .update(messages)
        .set({ state })
        .where(
          and(
            eq(messages.workspaceId, connection.workspaceId),
            eq(messages.providerMessageId, update.key.id),
            eq(messages.direction, 'outbound'),
          ),
        );
    }
    await publishChange(connection.workspaceId, 'messages.status');
  }

  async sendText(workspaceId: string, phone: string, body: string) {
    if (mockTransport()) return `mock-${crypto.randomUUID()}`;
    const socket = this.requireSocket(workspaceId);
    const jid = `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
    const result = await socket.sendMessage(jid, { text: body });
    if (!result?.key.id) throw new Error('WhatsApp did not return a message id');
    return result.key.id;
  }

  async sendMedia(
    workspaceId: string,
    phone: string,
    media: { buffer: Buffer; mimeType: string; filename?: string; kind: string; caption?: string },
  ) {
    if (mockTransport()) return `mock-${crypto.randomUUID()}`;
    const socket = this.requireSocket(workspaceId);
    const jid = `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
    const caption = media.caption || undefined;
    const content =
      media.kind === 'image'
        ? { image: media.buffer, mimetype: media.mimeType, caption }
        : media.kind === 'video'
          ? { video: media.buffer, mimetype: media.mimeType, caption }
          : media.kind === 'audio'
            ? { audio: media.buffer, mimetype: media.mimeType }
            : {
                document: media.buffer,
                mimetype: media.mimeType,
                fileName: media.filename ?? 'document',
                caption,
              };
    const result = await socket.sendMessage(jid, content);
    if (!result?.key.id) throw new Error('WhatsApp did not return a message id');
    return result.key.id;
  }

  async disconnect(workspaceId: string) {
    const active = this.connections.get(workspaceId);
    if (active?.reconnectTimer) clearTimeout(active.reconnectTimer);
    active?.socket.end(undefined);
    this.connections.delete(workspaceId);
    const [connection] = await db
      .select()
      .from(whatsappConnections)
      .where(eq(whatsappConnections.workspaceId, workspaceId))
      .limit(1);
    if (connection) {
      await this.updateConnection(connection, connection.generation + 1, {
        state: 'disconnected',
        qrCiphertext: null,
        qrExpiresAt: null,
      });
      await db
        .update(whatsappConnections)
        .set({ generation: connection.generation + 1 })
        .where(eq(whatsappConnections.id, connection.id));
    }
    await publishChange(workspaceId, 'whatsapp.disconnected');
  }

  async logout(workspaceId: string) {
    const active = this.connections.get(workspaceId);
    if (active) {
      try {
        await active.socket.logout();
      } catch {
        active.socket.end(undefined);
      }
      this.connections.delete(workspaceId);
    }
    const [connection] = await db
      .select()
      .from(whatsappConnections)
      .where(eq(whatsappConnections.workspaceId, workspaceId))
      .limit(1);
    if (connection) {
      await deleteBaileysAuthState(connection.id);
      await db
        .update(whatsappConnections)
        .set({
          state: 'logged_out',
          generation: connection.generation + 1,
          qrCiphertext: null,
          qrExpiresAt: null,
          connectedAt: null,
          lastError: 'The phone removed this linked device.',
          updatedAt: new Date(),
        })
        .where(eq(whatsappConnections.id, connection.id));
    }
    await publishChange(workspaceId, 'whatsapp.logged_out');
  }

  async startActiveConnections() {
    const rows = await db
      .select({ workspaceId: whatsappConnections.workspaceId })
      .from(whatsappConnections)
      .where(inArray(whatsappConnections.state, ['connecting', 'connected', 'error']));
    for (const row of rows) {
      await this.start(row.workspaceId).catch((error) =>
        logger.error({ error, workspaceId: row.workspaceId }, 'Failed to restore WhatsApp connection'),
      );
    }
  }

  async shutdown() {
    this.stopping = true;
    for (const [workspaceId, active] of this.connections) {
      if (active.reconnectTimer) clearTimeout(active.reconnectTimer);
      active.socket.end(undefined);
      this.connections.delete(workspaceId);
    }
  }

  private requireSocket(workspaceId: string) {
    const active = this.connections.get(workspaceId);
    if (!active || !active.socket.ws.isOpen) {
      throw new Error('WhatsApp is not connected');
    }
    return active.socket;
  }

  private async updateConnection(
    connection: ConnectionRecord,
    generation: number,
    patch: Partial<typeof whatsappConnections.$inferInsert>,
  ) {
    await db
      .update(whatsappConnections)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(whatsappConnections.id, connection.id),
          eq(whatsappConnections.generation, generation),
        ),
      );
  }
}

export const whatsappManager = new WhatsAppManager();
