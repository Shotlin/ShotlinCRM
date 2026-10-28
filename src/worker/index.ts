import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env.local');
} catch {
  // Deployment environments provide variables directly.
}

const start = async () => {
  const [
    { Worker },
    IORedis,
    { and, eq },
    { db },
    { conversations, messages, outboundJobs, replyDrafts },
    { loadOutboundPayload },
    { whatsappManager },
    { publishChange },
    { ingestMetaLead, markMetaEventFailed },
    { analyzeMessageFromRun },
    { enqueueAnalysisForMessage, markAnalysisRunFailed, reconcileQueuedRuns },
    { pool },
    { sweepDriveSync },
    { driveConfigured },
  ] = await Promise.all([
    import('bullmq'),
    import('ioredis'),
    import('drizzle-orm'),
    import('../server/db/client'),
    import('../server/db/schema'),
    import('../server/services/messages/send'),
    import('./whatsapp/manager'),
    import('../server/realtime'),
    import('../server/services/leads/ingestMetaLead'),
    import('../server/services/ai/analysis'),
    import('../server/services/ai/runs'),
    import('../server/db/client'),
    import('../server/services/invoicing/driveSync'),
    import('../server/services/invoicing/driveState'),
  ]);

  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const connection = new IORedis.default(redisUrl, { maxRetriesPerRequest: null });

  const outboundWorker = new Worker(
    'shotlin-outbound',
    async (job) => {
      const { workspaceId, messageId } = job.data as { workspaceId: string; messageId: string };
      const payload = await loadOutboundPayload(workspaceId, messageId);
      const providerMessageId = payload.media
        ? await whatsappManager.sendMedia(
            workspaceId,
            payload.lead.phone,
            payload.media,
          )
        : await whatsappManager.sendText(workspaceId, payload.lead.phone, payload.message.body);

      await db
        .update(messages)
        .set({ providerMessageId, state: 'sent' })
        .where(eq(messages.id, messageId));
      await db
        .update(outboundJobs)
        .set({ state: 'completed', attempts: job.attemptsMade + 1, updatedAt: new Date() })
        .where(eq(outboundJobs.messageId, messageId));
      await db
        .update(conversations)
        .set({ lastOutboundAt: new Date(), lastMessageAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(conversations.workspaceId, workspaceId),
            eq(conversations.leadId, payload.lead.id),
          ),
        );
      await publishChange(workspaceId, 'message.sent', payload.lead.id);
      const [sentDraft] = await db
        .update(replyDrafts)
        .set({ state: 'sent', updatedAt: new Date() })
        .where(
          and(
            eq(replyDrafts.workspaceId, workspaceId),
            eq(replyDrafts.sentMessageId, messageId),
            eq(replyDrafts.state, 'queued'),
          ),
        )
        .returning({ id: replyDrafts.id });
      if (sentDraft) await publishChange(workspaceId, 'ai.draft.sent', sentDraft.id);
      await enqueueAnalysisForMessage(workspaceId, messageId, 'outbound_sent').catch(
        () => undefined,
      );
    },
    { connection, concurrency: 2 },
  );

  outboundWorker.on('failed', (job, error) => {
    if (!job) return;
    const { workspaceId, messageId } = job.data as { workspaceId: string; messageId: string };
    if ((job.attemptsMade ?? 0) < (job.opts.attempts ?? 1)) return;
    void Promise.all([
      db.update(messages).set({ state: 'failed' }).where(eq(messages.id, messageId)),
      db
        .update(outboundJobs)
        .set({ state: 'failed', lastErrorCode: error.name.slice(0, 80), updatedAt: new Date() })
        .where(eq(outboundJobs.messageId, messageId)),
      db
        .update(replyDrafts)
        .set({ state: 'approved', sentMessageId: null, updatedAt: new Date() })
        .where(
          and(
            eq(replyDrafts.workspaceId, workspaceId),
            eq(replyDrafts.sentMessageId, messageId),
            eq(replyDrafts.state, 'queued'),
          ),
        ),
      publishChange(workspaceId, 'message.failed', messageId),
    ]).catch((failure) => console.error('Failed to record outbound job failure', failure));
  });

  const metaWorker = new Worker(
    'shotlin-meta',
    async (job) => {
      const { workspaceId, leadgenId } = job.data as { workspaceId: string; leadgenId: string };
      await ingestMetaLead(workspaceId, leadgenId);
    },
    { connection, concurrency: 2 },
  );

  metaWorker.on('failed', (job, error) => {
    if (!job) return;
    const { workspaceId, leadgenId } = job.data as { workspaceId: string; leadgenId: string };
    void markMetaEventFailed(workspaceId, leadgenId, error).catch((failure) =>
      console.error('Failed to record Meta lead failure', failure),
    );
  });

  const aiWorker = new Worker(
    'shotlin-ai',
    async (job) => {
      const { runId, workspaceId } = job.data as { runId: string; workspaceId: string };
      await analyzeMessageFromRun(runId, workspaceId);
    },
    { connection, concurrency: 2 },
  );

  aiWorker.on('failed', (job, error) => {
    if (!job) return;
    if ((job.attemptsMade ?? 0) < (job.opts.attempts ?? 1)) return;
    const { runId } = job.data as { runId: string };
    void markAnalysisRunFailed(runId, error).catch((failure) =>
      console.error('Failed to record AI analysis failure', failure),
    );
  });

  await reconcileQueuedRuns().catch(() => 0);
  const reconcileTimer = setInterval(() => {
    void reconcileQueuedRuns().catch(() => 0);
  }, 30_000);

  // Keeps invoice PDFs and the master workbook in Drive up to date, one invoice at a time.
  const driveTimer = driveConfigured()
    ? setInterval(() => {
        void sweepDriveSync().catch((error) => console.error('Drive sweep failed', error));
      }, 15_000)
    : undefined;

  const control = new IORedis.default(redisUrl, { maxRetriesPerRequest: null });
  await control.subscribe('shotlin:whatsapp:control');
  control.on('message', (_channel, raw) => {
    void (async () => {
      let event: { workspaceId: string; action: 'start' | 'disconnect' | 'logout' };
      try {
        event = JSON.parse(raw);
      } catch {
        return;
      }
      if (event.action === 'start') await whatsappManager.start(event.workspaceId);
      if (event.action === 'disconnect') await whatsappManager.disconnect(event.workspaceId);
      if (event.action === 'logout') await whatsappManager.logout(event.workspaceId);
    })().catch((error) => console.error('WhatsApp control action failed', error));
  });

  const heartbeat = new IORedis.default(redisUrl);
  const beat = () =>
    heartbeat
      .set(
        'shotlin:worker:heartbeat',
        JSON.stringify({
          at: new Date().toISOString(),
          transport: process.env.WHATSAPP_TRANSPORT === 'mock' ? 'mock' : 'live',
        }),
        'EX',
        30,
      )
      .catch(() => undefined);
  await beat();
  const heartbeatTimer = setInterval(beat, 10_000);

  if (process.env.WHATSAPP_TRANSPORT !== 'mock') {
    await whatsappManager.startActiveConnections();
  }

  const shutdown = async () => {
    clearInterval(heartbeatTimer);
    clearInterval(reconcileTimer);
    if (driveTimer) clearInterval(driveTimer);
    await whatsappManager.shutdown();
    await outboundWorker.close();
    await metaWorker.close();
    await aiWorker.close();
    await control.quit();
    await heartbeat.quit();
    await connection.quit();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  console.log('Shotlin WhatsApp worker is ready.');
};

start().catch((error) => {
  console.error('Shotlin worker failed to start', error);
  process.exit(1);
});
