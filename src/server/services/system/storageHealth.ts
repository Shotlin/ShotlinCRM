import { statfs } from 'node:fs/promises';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { messageMedia } from '../../db/schema';
import { listBucketObjects, resolveStorage } from '../../storage';
import { buildStorageHealth, type HealthDeps, type StorageHealth } from './storageLevels';

export * from './storageLevels';

const bucketCache = new Map<string, { at: number; bytes: number }>();

// The real measurements for one workspace: its bucket (if connected), this server's disk, and the database.
async function depsFor(workspaceId: string): Promise<HealthDeps> {
  const storage = await resolveStorage(workspaceId);
  return {
    mode: () => storage.mode,
    now: () => new Date(),
    limitGb: () => (storage.mode === 's3' ? storage.limitGb : 0),
    // Counting the bucket is a listing request, so it is cached for ten minutes.
    bucketBytes: async () => {
      if (storage.mode !== 's3') return null;
      const hit = bucketCache.get(workspaceId);
      if (hit && Date.now() - hit.at < 10 * 60_000) return hit.bytes;
      let bytes = 0;
      for await (const object of listBucketObjects(storage.config, `${workspaceId}/`)) bytes += object.sizeBytes;
      bucketCache.set(workspaceId, { at: Date.now(), bytes });
      return bytes;
    },
    mediaBytesOnServer: async () => {
      const [row] = await db
        .select({ total: sql<number>`coalesce(sum(${messageMedia.sizeBytes}), 0)::bigint` })
        .from(messageMedia)
        .where(eq(messageMedia.workspaceId, workspaceId));
      return Number(row?.total ?? 0);
    },
    disk: async () => {
      const stats = await statfs(process.cwd());
      return { totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize };
    },
    databaseBytes: async () => {
      const result = await db.execute(sql`select pg_database_size(current_database())::bigint as bytes`);
      return Number((result.rows[0] as { bytes: string | number } | undefined)?.bytes ?? 0);
    },
  };
}

const healthCache = new Map<string, { at: number; value: StorageHealth }>();

// Cached for a few minutes. Pass force to check right now.
export async function getStorageHealth(workspaceId: string, options: { force?: boolean } = {}): Promise<StorageHealth> {
  const hit = healthCache.get(workspaceId);
  if (!options.force && hit && Date.now() - hit.at < 5 * 60_000) return hit.value;
  if (options.force) bucketCache.delete(workspaceId);
  const value = await buildStorageHealth(await depsFor(workspaceId));
  healthCache.set(workspaceId, { at: Date.now(), value });
  return value;
}
