import { statfs } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { messageMedia } from '../../db/schema';
import { listBucketObjects, storageMode } from '../../storage';
import { buildStorageHealth, type HealthDeps, type StorageHealth } from './storageLevels';

export * from './storageLevels';

let bucketCache: { at: number; bytes: number } | null = null;

const realDeps: HealthDeps = {
  mode: storageMode,
  now: () => new Date(),
  limitGb: () => Number(process.env.STORAGE_LIMIT_GB ?? 10),
  // Counting the bucket is a listing request, so it is cached for ten minutes.
  bucketBytes: async () => {
    if (bucketCache && Date.now() - bucketCache.at < 10 * 60_000) return bucketCache.bytes;
    let bytes = 0;
    for await (const object of listBucketObjects()) bytes += object.sizeBytes;
    bucketCache = { at: Date.now(), bytes };
    return bytes;
  },
  mediaBytesOnServer: async () => {
    const [row] = await db.select({ total: sql<number>`coalesce(sum(${messageMedia.sizeBytes}), 0)::bigint` }).from(messageMedia);
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

let healthCache: { at: number; value: StorageHealth } | null = null;

// Cached for a few minutes. Pass force to check right now.
export async function getStorageHealth(options: { force?: boolean } = {}): Promise<StorageHealth> {
  if (!options.force && healthCache && Date.now() - healthCache.at < 5 * 60_000) return healthCache.value;
  if (options.force) bucketCache = null;
  const value = await buildStorageHealth(realDeps);
  healthCache = { at: Date.now(), value };
  return value;
}
