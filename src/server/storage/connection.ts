import { and, count, eq } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile, stat, unlink } from 'node:fs/promises';
import { z } from 'zod';
import { db } from '../db/client';
import { messageMedia, storageConnections } from '../db/schema';
import { decryptSecret, encryptSecret } from '../security/envelope';
import {
  clearStorageCache,
  deleteObjectFromBucket,
  getObjectFromBucket,
  headObjectInBucket,
  localMediaPath,
  putObjectToBucket,
  type BucketConfig,
  type SavedConnection,
} from './index';

// The address is built from the account id alone, so it can only ever point at Cloudflare R2.
// The override exists for tests and is ignored in production.
export function r2Endpoint(accountId: string) {
  const override = process.env.NODE_ENV !== 'production' ? process.env.R2_ENDPOINT_OVERRIDE : undefined;
  return override || `https://${accountId}.r2.cloudflarestorage.com`;
}

const clean = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, '') : value);

export const connectionInputSchema = z.object({
  accountId: z.preprocess(clean, z.string().regex(/^[0-9a-fA-F]{32}$/, 'The Account ID should be 32 letters and numbers.')).transform((v) => v.toLowerCase()),
  bucket: z.preprocess(clean, z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'The bucket name should be lowercase letters, numbers and hyphens.')),
  accessKeyId: z.preprocess(clean, z.string().regex(/^[A-Za-z0-9]{16,128}$/, 'The Access Key ID looks incomplete. Copy it in full.')),
  secretAccessKey: z.preprocess(clean, z.string().regex(/^[A-Za-z0-9/+=_-]{32,200}$/, 'The Secret Access Key looks incomplete. Copy it in full.')),
  limitGb: z.coerce.number().int().min(1, 'The limit should be at least 1 GB.').max(100_000).default(10),
});

export type ConnectionInput = z.infer<typeof connectionInputSchema>;

export const toBucketConfig = (input: Pick<ConnectionInput, 'accountId' | 'bucket' | 'accessKeyId' | 'secretAccessKey'>): BucketConfig => ({
  endpoint: r2Endpoint(input.accountId),
  region: 'auto',
  bucket: input.bucket,
  accessKeyId: input.accessKeyId,
  secretAccessKey: input.secretAccessKey,
  forcePathStyle: true,
  provider: 'r2',
});

// Turns Cloudflare's technical errors into something a person can act on. Never repeats the keys.
export function explainStorageError(error: unknown) {
  const e = error as { name?: string; Code?: string; code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const name = e.name ?? e.Code ?? e.code ?? '';
  const status = e.$metadata?.httpStatusCode;
  if (/NoSuchBucket/.test(name)) return 'The bucket name is wrong, or the bucket does not exist in that Cloudflare account.';
  if (/InvalidAccessKeyId|SignatureDoesNotMatch|InvalidSignature/.test(name) || status === 401) {
    return 'The Access Key ID or Secret Access Key is wrong. Check both were copied in full.';
  }
  if (/AccessDenied|Forbidden/.test(name) || status === 403) {
    return 'The keys work but are not allowed to write here. In Cloudflare, make the API token "Object Read & Write" for this bucket.';
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|fetch failed|getaddrinfo/i.test(`${name} ${e.message}`)) {
    return 'Cloudflare could not be reached. Check the Account ID is right (32 characters).';
  }
  return 'The bucket did not accept the request. Check the Account ID, bucket name and keys.';
}

export type TestStep = { name: string; ok: boolean; message?: string };

// Proves the bucket works: saves a tiny file, reads it back, checks it, and removes it.
export async function testBucket(config: BucketConfig): Promise<{ ok: boolean; steps: TestStep[] }> {
  const steps: TestStep[] = [];
  const key = `healthcheck/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  const payload = Buffer.from(`Shotlin CRM storage check ${new Date().toISOString()}`);
  const run = async (name: string, action: () => Promise<void>) => {
    try {
      await action();
      steps.push({ name, ok: true });
      return true;
    } catch (error) {
      steps.push({ name, ok: false, message: error instanceof Error && error.message.startsWith('CHECK:') ? error.message.slice(6) : explainStorageError(error) });
      return false;
    }
  };
  const ok =
    (await run('Reach the bucket and save a test file', () => putObjectToBucket(config, key, payload, 'text/plain'))) &&
    (await run('Read the file back unchanged', async () => {
      if (!(await getObjectFromBucket(config, key)).equals(payload)) throw new Error('CHECK:The file read back is not the same as the one saved.');
    })) &&
    (await run('Check its size', async () => {
      if ((await headObjectInBucket(config, key))?.sizeBytes !== payload.length) throw new Error('CHECK:The stored size does not match.');
    })) &&
    (await run('Remove the test file', async () => {
      await deleteObjectFromBucket(config, key);
      if (await headObjectInBucket(config, key)) throw new Error('CHECK:The test file could not be removed. The token also needs delete permission.');
    }));
  if (!ok) await deleteObjectFromBucket(config, key).catch(() => undefined);
  return { ok, steps };
}

// ---------------------------------------------------------------- saved connection

export async function saveConnection(workspaceId: string, input: ConnectionInput) {
  const [media] = await db
    .select({ total: count() })
    .from(messageMedia)
    .where(and(eq(messageMedia.workspaceId, workspaceId), eq(messageMedia.state, 'ready')));
  const values = {
    provider: 'r2',
    accountId: input.accountId,
    bucket: input.bucket,
    accessKeyCiphertext: encryptSecret(input.accessKeyId),
    secretKeyCiphertext: encryptSecret(input.secretAccessKey),
    limitGb: input.limitGb,
    // New files keep going to this server's disk until the copy has finished and been checked.
    state: 'migrating',
    totalFiles: Number(media?.total ?? 0),
    copiedFiles: 0,
    lastError: null,
    connectedAt: null,
    updatedAt: new Date(),
  };
  await db
    .insert(storageConnections)
    .values({ workspaceId, ...values })
    .onConflictDoUpdate({ target: storageConnections.workspaceId, set: values });
  clearStorageCache(workspaceId);
}

async function loadRow(workspaceId: string) {
  const [row] = await db.select().from(storageConnections).where(eq(storageConnections.workspaceId, workspaceId)).limit(1);
  return row ?? null;
}

const configFromRow = (row: NonNullable<Awaited<ReturnType<typeof loadRow>>>): BucketConfig =>
  toBucketConfig({
    accountId: row.accountId,
    bucket: row.bucket,
    accessKeyId: decryptSecret(row.accessKeyCiphertext),
    secretAccessKey: decryptSecret(row.secretKeyCiphertext),
  });

// Used by the storage layer: only a connection that has finished copying is used for new files.
export async function loadConnectedConfig(workspaceId: string): Promise<SavedConnection | null> {
  const row = await loadRow(workspaceId);
  if (!row || row.state !== 'connected') return null;
  return { config: configFromRow(row), limitGb: row.limitGb };
}

export type ConnectionStatus = {
  state: 'none' | 'migrating' | 'connected' | 'error';
  accountId: string | null;
  bucket: string | null;
  accessKeyHint: string | null;
  limitGb: number | null;
  totalFiles: number;
  copiedFiles: number;
  lastError: string | null;
  connectedAt: string | null;
};

// What the browser may see. The secret key never leaves the server, and only the start of the key id is shown.
export async function connectionStatus(workspaceId: string): Promise<ConnectionStatus> {
  const row = await loadRow(workspaceId);
  if (!row) {
    return { state: 'none', accountId: null, bucket: null, accessKeyHint: null, limitGb: null, totalFiles: 0, copiedFiles: 0, lastError: null, connectedAt: null };
  }
  let hint: string | null = null;
  try {
    hint = `${decryptSecret(row.accessKeyCiphertext).slice(0, 4)}…`;
  } catch {
    hint = null;
  }
  return {
    state: row.state as ConnectionStatus['state'],
    accountId: row.accountId,
    bucket: row.bucket,
    accessKeyHint: hint,
    limitGb: row.limitGb,
    totalFiles: row.totalFiles,
    copiedFiles: row.copiedFiles,
    lastError: row.lastError,
    connectedAt: row.connectedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------- copying existing files

type PassResult = { copied: number; missing: number; failed: number; firstError: string | null; total: number };

async function copyPass(workspaceId: string, config: BucketConfig, report?: (done: number) => Promise<void>): Promise<PassResult> {
  const rows = await db
    .select({ objectKey: messageMedia.objectKey, mimeType: messageMedia.mimeType, checksum: messageMedia.checksum })
    .from(messageMedia)
    .where(and(eq(messageMedia.workspaceId, workspaceId), eq(messageMedia.state, 'ready')));
  const result: PassResult = { copied: 0, missing: 0, failed: 0, firstError: null, total: rows.length };
  let index = 0;
  for (const row of rows) {
    index += 1;
    try {
      const local = localMediaPath(row.objectKey);
      const existing = await headObjectInBucket(config, row.objectKey);
      if (!existsSync(local)) {
        // Moved earlier, or never on this disk.
        if (existing) result.copied += 1;
        else result.missing += 1;
      } else {
        const size = (await stat(local)).size;
        if (existing?.sizeBytes !== size) {
          await putObjectToBucket(config, row.objectKey, await readFile(local), row.mimeType, { checksum: row.checksum });
          if ((await headObjectInBucket(config, row.objectKey))?.sizeBytes !== size) throw new Error('size in the bucket does not match after upload');
        }
        result.copied += 1;
      }
    } catch (error) {
      result.failed += 1;
      result.firstError ??= explainStorageError(error);
    }
    if (report && index % 10 === 0) await report(result.copied);
  }
  return result;
}

// Deletes a file from this server's disk only after the bucket holds an identical copy:
// same size, and the bytes hash to the checksum recorded when the file was received.
export async function removeVerifiedLocalCopies(workspaceId: string, config: BucketConfig) {
  const rows = await db
    .select({ objectKey: messageMedia.objectKey, checksum: messageMedia.checksum })
    .from(messageMedia)
    .where(eq(messageMedia.workspaceId, workspaceId));
  const outcome = { removed: 0, freedBytes: 0, kept: 0 };
  for (const row of rows) {
    const local = localMediaPath(row.objectKey);
    if (!existsSync(local)) continue;
    try {
      const size = (await stat(local)).size;
      const head = await headObjectInBucket(config, row.objectKey);
      if (head?.sizeBytes !== size) throw new Error('not in the bucket yet');
      const remote = await getObjectFromBucket(config, row.objectKey);
      if (createHash('sha256').update(remote).digest('hex') !== row.checksum) throw new Error('bucket copy differs');
      await unlink(local);
      outcome.removed += 1;
      outcome.freedBytes += size;
    } catch {
      outcome.kept += 1;
    }
  }
  return outcome;
}

// Copies everything still on this server's disk into the bucket, then switches the workspace over.
// Once a copy is proven identical in the bucket, the server's copy is removed. Safe to run again.
export async function runMigration(workspaceId: string) {
  const row = await loadRow(workspaceId);
  if (!row || row.state !== 'migrating') return null;
  const config = configFromRow(row);
  const progress = async (done: number) => {
    await db.update(storageConnections).set({ copiedFiles: done, updatedAt: new Date() }).where(eq(storageConnections.workspaceId, workspaceId));
  };

  let result = await copyPass(workspaceId, config, progress);
  // A second pass picks up anything that arrived while the first one ran.
  if (result.failed === 0) result = await copyPass(workspaceId, config, progress);

  if (result.failed > 0) {
    await db
      .update(storageConnections)
      .set({
        state: 'error',
        copiedFiles: result.copied,
        totalFiles: result.total,
        lastError: `${result.failed} of ${result.total} files could not be copied. ${result.firstError ?? ''}`.trim(),
        updatedAt: new Date(),
      })
      .where(eq(storageConnections.workspaceId, workspaceId));
  } else {
    await db
      .update(storageConnections)
      .set({
        state: 'connected',
        copiedFiles: result.copied,
        totalFiles: result.total,
        lastError: result.missing > 0 ? `${result.missing} file(s) were already missing from this server before the move.` : null,
        connectedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(storageConnections.workspaceId, workspaceId));
    await removeVerifiedLocalCopies(workspaceId, config);
  }
  clearStorageCache(workspaceId);
  return result;
}

let sweeping = false;

// Run by the worker every few seconds.
export async function sweepStorageMigrations() {
  if (sweeping) return 0;
  sweeping = true;
  try {
    const pending = await db
      .select({ workspaceId: storageConnections.workspaceId })
      .from(storageConnections)
      .where(eq(storageConnections.state, 'migrating'));
    for (const item of pending) {
      try {
        await runMigration(item.workspaceId);
      } catch (error) {
        await db
          .update(storageConnections)
          .set({ state: 'error', lastError: explainStorageError(error), updatedAt: new Date() })
          .where(eq(storageConnections.workspaceId, item.workspaceId));
      }
    }
    return pending.length;
  } finally {
    sweeping = false;
  }
}
