import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { getEnv } from '../env';

let connection: IORedis | null = null;
const queues = new Map<string, Queue>();

export function redisConnection() {
  if (!connection) {
    connection = new IORedis(getEnv().REDIS_URL, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getOutboundQueue() {
  let queue = queues.get('outbound');
  if (!queue) {
    queue = new Queue('shotlin-outbound', { connection: redisConnection() });
    queues.set('outbound', queue);
  }
  return queue;
}

export function getMetaQueue() {
  let queue = queues.get('meta');
  if (!queue) {
    queue = new Queue('shotlin-meta', { connection: redisConnection() });
    queues.set('meta', queue);
  }
  return queue;
}

export function getAiQueue() {
  let queue = queues.get('ai');
  if (!queue) {
    queue = new Queue('shotlin-ai', { connection: redisConnection() });
    queues.set('ai', queue);
  }
  return queue;
}

export async function queueOutboundJob(messageId: string, workspaceId: string) {
  return getOutboundQueue().add(
    'send',
    { messageId, workspaceId },
    {
      jobId: messageId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 3_000 },
      removeOnComplete: 500,
      removeOnFail: 500,
    },
  );
}

export async function queueMetaLeadJob(workspaceId: string, leadgenId: string) {
  return getMetaQueue().add(
    'ingest',
    { workspaceId, leadgenId },
    {
      attempts: 4,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 500,
      removeOnFail: 500,
    },
  );
}

export async function queueAiRun(runId: string, workspaceId: string) {
  const queue = getAiQueue();
  const existing = await queue.getJob(runId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'failed' || state === 'completed') {
      await existing.remove();
    } else {
      return existing;
    }
  }
  return queue.add(
    'analyze-message',
    { runId, workspaceId },
    {
      jobId: runId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 1_000,
      removeOnFail: 1_000,
    },
  );
}

export async function signalWhatsAppControl(workspaceId: string, action: 'start' | 'disconnect' | 'logout') {
  await redisConnection().publish('shotlin:whatsapp:control', JSON.stringify({ workspaceId, action }));
}
