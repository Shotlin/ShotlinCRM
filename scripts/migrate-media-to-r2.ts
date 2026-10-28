import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env.local');
} catch {
  // Deployment environments provide variables directly.
}

// Copies every WhatsApp media file that is still on this server's disk into the bucket.
// It never deletes anything: the local copies stay until you decide to remove them.
// Safe to run again; files already in the bucket with the right size are skipped.
const dryRun = process.argv.includes('--dry-run');
const { db, pool } = await import('../src/server/db/client');
const { messageMedia } = await import('../src/server/db/schema');
const { headObjectInBucket, localMediaPath, putObjectToBucket } = await import('../src/server/storage');
const { eq } = await import('drizzle-orm');

const rows = await db.select().from(messageMedia).where(eq(messageMedia.state, 'ready'));
let copied = 0;
let already = 0;
let missingLocal = 0;
let failed = 0;
let bytes = 0;

for (const row of rows) {
  try {
    const local = localMediaPath(row.objectKey);
    if (!existsSync(local)) {
      // Already moved earlier, or never on this disk. Check the bucket before calling it missing.
      if (await headObjectInBucket(row.objectKey)) already += 1;
      else {
        missingLocal += 1;
        console.warn(`MISSING ${row.objectKey} is neither on disk nor in the bucket`);
      }
      continue;
    }
    const size = (await stat(local)).size;
    const existing = await headObjectInBucket(row.objectKey);
    if (existing && existing.sizeBytes === size) {
      already += 1;
      continue;
    }
    if (dryRun) {
      copied += 1;
      bytes += size;
      continue;
    }
    await putObjectToBucket(row.objectKey, await readFile(local), row.mimeType, { checksum: row.checksum });
    const check = await headObjectInBucket(row.objectKey);
    if (check?.sizeBytes !== size) throw new Error('size in the bucket does not match after upload');
    copied += 1;
    bytes += size;
  } catch (error) {
    failed += 1;
    console.error(`FAILED ${row.objectKey}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(
  `${dryRun ? 'Would copy' : 'Copied'}: ${copied} files (${(bytes / 1024 / 1024).toFixed(1)} MB) | already in bucket: ${already} | missing: ${missingLocal} | failed: ${failed} | total: ${rows.length}`,
);
await pool.end();
process.exit(failed > 0 || missingLocal > 0 ? 1 : 0);
