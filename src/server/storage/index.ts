import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getEnv } from '../env';

export type StoredMedia = {
  objectKey: string;
  sizeBytes: number;
  checksum: string;
  mimeType: string;
};

const extensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'application/pdf': 'pdf',
};

const localRoot = path.join(process.cwd(), '.local', 'media');

// ---------------------------------------------------------------- bucket access

// Everything needed to talk to one bucket. Cloudflare R2 speaks the S3 protocol but is not AWS.
export type BucketConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  provider: 'r2' | 'aws' | 'other';
};

export const isR2 = (config: BucketConfig) => config.provider === 'r2';

function detectProvider(endpoint: string): BucketConfig['provider'] {
  const forced = process.env.S3_PROVIDER?.toLowerCase();
  if (forced === 'r2' || forced === 'aws') return forced;
  if (endpoint.includes('.r2.cloudflarestorage.com')) return 'r2';
  return 'other';
}

// The bucket described in the server's settings file (S3_* values). Used before one is saved in the CRM.
export function envBucketConfig(): BucketConfig {
  const env = getEnv();
  return {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
    provider: detectProvider(env.S3_ENDPOINT),
  };
}

const clients = new Map<string, S3Client>();

function clientFor(config: BucketConfig) {
  const key = [config.endpoint, config.bucket, config.accessKeyId, createHash('sha256').update(config.secretAccessKey).digest('hex')].join('|');
  let client = clients.get(key);
  if (!client) {
    client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // R2 does not need the extra checksum headers newer AWS SDKs add by default.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    clients.set(key, client);
  }
  return client;
}

const checkKey = (objectKey: string) => {
  if (!objectKey || objectKey.includes('..') || objectKey.startsWith('/')) throw new Error('Invalid object key');
};

export const isMissing = (error: unknown) => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
};

export async function putObjectToBucket(
  config: BucketConfig,
  objectKey: string,
  buffer: Buffer,
  mimeType: string,
  metadata?: Record<string, string>,
) {
  checkKey(objectKey);
  await clientFor(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: mimeType,
      Metadata: metadata,
      // R2 always encrypts at rest, and rejects the AWS header. Only AWS needs it asked for.
      ...(isR2(config) ? {} : { ServerSideEncryption: 'AES256' as const }),
    }),
  );
}

export async function headObjectInBucket(config: BucketConfig, objectKey: string): Promise<{ sizeBytes: number } | null> {
  checkKey(objectKey);
  try {
    const result = await clientFor(config).send(new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey }));
    return { sizeBytes: Number(result.ContentLength ?? 0) };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export async function deleteObjectFromBucket(config: BucketConfig, objectKey: string) {
  checkKey(objectKey);
  await clientFor(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }));
}

export type ListedObject = { key: string; sizeBytes: number; lastModified: Date | null };

// Walks every page of a listing, so a large bucket is counted in full.
export async function* listBucketObjects(config: BucketConfig, prefix = ''): AsyncGenerator<ListedObject> {
  let token: string | undefined;
  do {
    const page = await clientFor(config).send(
      new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const item of page.Contents ?? []) {
      if (item.Key) yield { key: item.Key, sizeBytes: Number(item.Size ?? 0), lastModified: item.LastModified ?? null };
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

export async function getObjectFromBucket(config: BucketConfig, objectKey: string): Promise<Buffer> {
  checkKey(objectKey);
  const result = await clientFor(config).send(new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }));
  if (!result.Body) throw new Error('Media object not found');
  return Buffer.from(await result.Body.transformToByteArray());
}

// ---------------------------------------------------------------- where each workspace's files live

export type ResolvedStorage =
  | { mode: 'local' }
  | { mode: 's3'; config: BucketConfig; limitGb: number; source: 'settings' | 'env' };

export type SavedConnection = { config: BucketConfig; limitGb: number };

type Loader = (workspaceId: string) => Promise<SavedConnection | null>;

let testLoader: Loader | null = null;
// Lets tests supply the saved connection without a database.
export const setSavedConnectionLoader = (loader: Loader | null) => {
  testLoader = loader;
  cache.clear();
};

const CACHE_MS = 20_000;
const cache = new Map<string, { at: number; value: ResolvedStorage }>();

export const clearStorageCache = (workspaceId?: string) => {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
};

// A connection saved in the CRM wins. Without one, the server's settings file decides, and with
// neither, files stay on this server's disk. The answer is cached for a few seconds, so changing
// the connection takes effect in the web app and the worker without a restart.
export async function resolveStorage(workspaceId: string): Promise<ResolvedStorage> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const loader: Loader = testLoader ?? (await import('./connection')).loadConnectedConfig;
  const saved = await loader(workspaceId);
  let value: ResolvedStorage;
  if (saved) value = { mode: 's3', config: saved.config, limitGb: saved.limitGb, source: 'settings' };
  else if ((process.env.S3_MODE ?? 'local') === 's3') {
    value = { mode: 's3', config: envBucketConfig(), limitGb: Number(process.env.STORAGE_LIMIT_GB ?? 10), source: 'env' };
  } else value = { mode: 'local' };
  cache.set(workspaceId, { at: Date.now(), value });
  return value;
}

// Every object key starts with the workspace id, so the key alone says whose bucket to use.
export const workspaceOfKey = (objectKey: string) => objectKey.split('/')[0];

export async function putPrivateMedia({
  workspaceId,
  buffer,
  mimeType,
  filename,
}: {
  workspaceId: string;
  buffer: Buffer;
  mimeType: string;
  filename?: string;
}): Promise<StoredMedia> {
  if (buffer.length === 0) throw new Error('Empty media file');
  if (buffer.length > 64 * 1024 * 1024) throw new Error('Media exceeds the 64 MB limit');
  const safeName = (filename ?? 'file').replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100);
  const objectKey = `${workspaceId}/${randomUUID()}.${extensions[mimeType] ?? 'bin'}`;
  const checksum = createHash('sha256').update(buffer).digest('hex');

  const storage = await resolveStorage(workspaceId);
  if (storage.mode === 's3') {
    await putObjectToBucket(storage.config, objectKey, buffer, mimeType, { checksum, originalFilename: safeName });
  } else {
    const target = path.join(localRoot, objectKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer, { mode: 0o600 });
  }

  return { objectKey, sizeBytes: buffer.length, checksum, mimeType };
}

export async function getPrivateMedia(objectKey: string): Promise<Buffer> {
  checkKey(objectKey);
  const storage = await resolveStorage(workspaceOfKey(objectKey));
  if (storage.mode === 's3') {
    try {
      return await getObjectFromBucket(storage.config, objectKey);
    } catch (error) {
      // While files are being moved to the bucket, one that has not moved yet is still on local disk.
      if (!isMissing(error)) throw error;
      return readFile(path.join(localRoot, objectKey));
    }
  }
  return readFile(path.join(localRoot, objectKey));
}

// The path of a media file on this server's disk, for the one-off move to the bucket.
export const localMediaPath = (objectKey: string) => {
  checkKey(objectKey);
  return path.join(localRoot, objectKey);
};

export function mediaKindFor(mimeType: string): 'image' | 'video' | 'audio' | 'document' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}
