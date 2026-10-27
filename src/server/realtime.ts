import Redis from 'ioredis';
import { getEnv } from './env';

let publisher: Redis | null = null;

export function getPublisher() {
  if (!publisher) {
    publisher = new Redis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    });
  }
  return publisher;
}

export const workspaceEventChannel = (workspaceId: string) => `shotlin:events:${workspaceId}`;

export async function publishChange(workspaceId: string, type: string, entityId?: string) {
  await getPublisher().publish(
    workspaceEventChannel(workspaceId),
    JSON.stringify({ type, entityId: entityId ?? null, at: new Date().toISOString() }),
  );
}
