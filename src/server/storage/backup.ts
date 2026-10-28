import { spawn } from 'node:child_process';
import { listBucketObjects, deleteObjectFromBucket, headObjectInBucket, putObjectToBucket, resolveStorage } from './index';

export const KEEP_BACKUPS = 7;
// Backups run once the clock in India passes this hour, so they happen overnight.
export const BACKUP_HOUR_IST = 2;

export const backupPrefix = (workspaceId: string) => `${workspaceId}/backups/`;
const istDate = (now: Date) => new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const backupKey = (workspaceId: string, now: Date) => `${backupPrefix(workspaceId)}db-${istDate(now)}.dump`;
export const backupDue = (now: Date) => new Date(now.getTime() + 5.5 * 3600_000).getUTCHours() >= BACKUP_HOUR_IST;

// Names of the backups to delete: everything except the newest `keep`. Only files that look like our own dumps.
export function expiredBackups(keys: string[], keep = KEEP_BACKUPS) {
  return keys
    .filter((key) => /\/db-\d{4}-\d{2}-\d{2}\.dump$/.test(key))
    .sort()
    .reverse()
    .slice(keep);
}

function dumpDatabase(): Promise<Buffer> {
  const url = process.env.DATABASE_URL;
  if (!url) return Promise.reject(new Error('DATABASE_URL is not set'));
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PG_DUMP_BIN ?? 'pg_dump', ['--format=custom', '--no-owner', '--dbname', url]);
    const chunks: Buffer[] = [];
    let errors = '';
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      const dump = Buffer.concat(chunks);
      if (code !== 0) reject(new Error(`pg_dump failed: ${errors.slice(0, 300)}`));
      else if (dump.length < 5 || dump.subarray(0, 5).toString() !== 'PGDMP') reject(new Error('pg_dump gave an unreadable file'));
      else resolve(dump);
    });
  });
}

// One backup a night into the workspace's own R2 bucket, keeping the newest seven.
export async function runNightlyBackup(workspaceId: string, now = new Date()) {
  const storage = await resolveStorage(workspaceId);
  if (storage.mode !== 's3' || !backupDue(now)) return 'skipped' as const;
  const key = backupKey(workspaceId, now);
  if (await headObjectInBucket(storage.config, key)) return 'exists' as const;
  const dump = await dumpDatabase();
  await putObjectToBucket(storage.config, key, dump, 'application/octet-stream', { kind: 'database-backup' });
  if ((await headObjectInBucket(storage.config, key))?.sizeBytes !== dump.length) throw new Error('backup size in R2 does not match');
  const keys: string[] = [];
  for await (const object of listBucketObjects(storage.config, backupPrefix(workspaceId))) keys.push(object.key);
  for (const old of expiredBackups(keys)) await deleteObjectFromBucket(storage.config, old);
  return 'done' as const;
}
