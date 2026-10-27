import { createHash, randomUUID } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '../../db/client';
import { aiAnalysisRuns, messages } from '../../db/schema';
import { queueAiRun } from '../../queues';
import { AI_PROMPT_VERSION, AI_SCHEMA_VERSION } from './constants';
import { getAiConfig, countBudgetUsageThisMonth, RESERVED_TOKENS_PER_RUN } from './settings';

export async function createAnalysisRun(
  workspaceId: string,
  messageId: string,
  trigger: string,
) {
  const config = await getAiConfig(workspaceId);
  if (!config) return null;
  const [message] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.workspaceId, workspaceId)))
    .limit(1);
  if (!message) return null;

  const inputHash = createHash('sha256')
    .update(
      JSON.stringify({
        message: [
          message.id,
          message.body,
          message.kind,
          message.direction,
          message.sentAt.toISOString(),
          message.state,
        ],
        promptVersion: AI_PROMPT_VERSION,
        schemaVersion: AI_SCHEMA_VERSION,
        provider: config.provider,
        model: config.model,
      }),
    )
    .digest('hex');

  const [existing] = await db
    .select()
    .from(aiAnalysisRuns)
    .where(
      and(
        eq(aiAnalysisRuns.workspaceId, workspaceId),
        eq(aiAnalysisRuns.entityType, 'message'),
        eq(aiAnalysisRuns.entityId, messageId),
        eq(aiAnalysisRuns.inputHash, inputHash),
      ),
    )
    .limit(1);
  if (existing) return { run: existing, created: false };

  const [run] = await db
    .insert(aiAnalysisRuns)
    .values({
      id: randomUUID(),
      workspaceId,
      entityType: 'message',
      entityId: messageId,
      trigger,
      inputHash,
      promptVersion: AI_PROMPT_VERSION,
      schemaVersion: AI_SCHEMA_VERSION,
      provider: config.provider,
      model: config.model,
      state: 'queued',
    })
    .returning();
  return { run, created: true };
}

export async function createEntityRun(input: {
  workspaceId: string;
  entityType: string;
  entityId: string;
  trigger: string;
  inputHash: string;
}) {
  const config = await getAiConfig(input.workspaceId);
  if (!config) return null;
  const [existing] = await db
    .select()
    .from(aiAnalysisRuns)
    .where(
      and(
        eq(aiAnalysisRuns.workspaceId, input.workspaceId),
        eq(aiAnalysisRuns.entityType, input.entityType),
        eq(aiAnalysisRuns.entityId, input.entityId),
        eq(aiAnalysisRuns.inputHash, input.inputHash),
      ),
    )
    .limit(1);
  if (existing) return { run: existing, config };

  const [run] = await db
    .insert(aiAnalysisRuns)
    .values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      entityType: input.entityType,
      entityId: input.entityId,
      trigger: input.trigger,
      inputHash: input.inputHash,
      promptVersion: AI_PROMPT_VERSION,
      schemaVersion: AI_SCHEMA_VERSION,
      provider: config.provider,
      model: config.model,
      state: 'queued',
    })
    .returning();
  return { run, config };
}

export async function enqueueAnalysisForMessage(
  workspaceId: string,
  messageId: string,
  trigger: string,
) {
  const created = await createAnalysisRun(workspaceId, messageId, trigger);
  if (!created) return { queued: false, reason: 'not_configured' as const };
  if (created.run.state === 'succeeded' || created.run.state === 'partial') {
    return { queued: false, reason: 'already_analyzed' as const };
  }
  await queueAiRun(created.run.id, workspaceId);
  return { queued: true, runId: created.run.id };
}

export async function enqueueBackfill(workspaceId: string) {
  const config = await getAiConfig(workspaceId);
  if (!config) throw new Error('Configure and enable an AI provider before analyzing history');
  const used = await countBudgetUsageThisMonth(workspaceId);
  const capacity = Math.max(
    0,
    Math.floor(
      Math.max(0, config.monthlyTokenBudget - used) / RESERVED_TOKENS_PER_RUN,
    ),
  );
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.workspaceId, workspaceId))
    .orderBy(messages.sentAt);

  let queued = 0;
  let skipped = 0;
  let failed = 0;
  let budgetSkipped = 0;
  for (const message of rows) {
    if (queued >= capacity) {
      budgetSkipped += 1;
      continue;
    }
    try {
      const created = await createAnalysisRun(workspaceId, message.id, 'backfill');
      if (!created) {
        skipped += 1;
        continue;
      }
      if (created.run.state === 'succeeded' || created.run.state === 'partial') {
        skipped += 1;
        continue;
      }
      await queueAiRun(created.run.id, workspaceId);
      queued += 1;
    } catch {
      failed += 1;
    }
  }
  return { queued, skipped, failed, budgetSkipped, total: rows.length };
}

export async function reconcileQueuedRuns(limit = 100) {
  const staleBefore = new Date(Date.now() - 10 * 60_000);
  await db
    .update(aiAnalysisRuns)
    .set({
      state: 'queued',
      errorCode: 'stale_worker',
      errorMessage: 'Recovered an interrupted analysis run',
    })
    .where(
      and(
        eq(aiAnalysisRuns.state, 'running'),
        lt(aiAnalysisRuns.startedAt, staleBefore),
      ),
    );
  const rows = await db
    .select({
      id: aiAnalysisRuns.id,
      workspaceId: aiAnalysisRuns.workspaceId,
    })
    .from(aiAnalysisRuns)
    .where(eq(aiAnalysisRuns.state, 'queued'))
    .limit(limit);
  let enqueued = 0;
  for (const row of rows) {
    try {
      await queueAiRun(row.id, row.workspaceId);
      enqueued += 1;
    } catch {
      // The next reconciliation pass retries this run.
    }
  }
  return enqueued;
}

export async function markAnalysisRunFailed(runId: string, error: unknown) {
  const message = error instanceof Error ? error.message : 'Analysis failed';
  await db
    .update(aiAnalysisRuns)
    .set({
      state: 'failed',
      errorCode: 'worker_failed',
      errorMessage: message.slice(0, 300),
      completedAt: new Date(),
    })
    .where(eq(aiAnalysisRuns.id, runId));
}
