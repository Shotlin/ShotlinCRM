import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
  type WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { and, eq, inArray } from 'drizzle-orm';
import pino from 'pino';
import { db } from '../../server/db/client';
import { whatsappConnections } from '../../server/db/schema';
import { encryptSecret } from '../../server/security/envelope';
import { ingestInboundMessage } from '../../server/services/conversations/ingest';
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
      syncFullHistory: false,
      markOnlineOnConnect: false,
      logger,
      browser: ['Shotlin CRM', 'Chrome', '1.0.0'],
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
        void this.handleIncomingMessage(connection, socket, raw).catch((error) =>
          logger.error({ error }, 'Failed to ingest WhatsApp message'),
        );
      }
    });

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

  private async handleIncomingMessage(connection: ConnectionRecord, socket: WASocket, raw: WAMessage) {
    if (raw.key.fromMe) return;
    const normalized = normalizeWhatsAppMessage(raw);
    if (!normalized) return;

    let storedMedia;
    if (normalized.mimeType && normalized.kind !== 'text') {
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

    await ingestInboundMessage({
      workspaceId: connection.workspaceId,
      providerMessageId: normalized.providerMessageId,
      remoteJid: normalized.remoteJid,
      phone: normalized.phone,
      pushName: normalized.pushName,
      sentAt: normalized.sentAt,
      kind: normalized.kind,
      body: normalized.body,
      media: storedMedia ? { ...storedMedia, filename: normalized.filename } : undefined,
    });
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
