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

let s3: S3Client | null = null;

// Cloudflare R2 speaks the S3 protocol but is not AWS. Set S3_PROVIDER to "r2" or "aws" to force it;
// otherwise it is worked out from the endpoint address.
export function isR2() {
  const provider = process.env.S3_PROVIDER?.toLowerCase();
  if (provider) return provider === 'r2';
  return (process.env.S3_ENDPOINT ?? '').includes('.r2.cloudflarestorage.com');
}

function s3Client() {
  if (!s3) {
    const env = getEnv();
    s3 = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
      // R2 does not need the extra checksum headers newer AWS SDKs add by default.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return s3;
}

export const storageMode = () => process.env.S3_MODE ?? 'local';

const checkKey = (objectKey: string) => {
  if (!objectKey || objectKey.includes('..') || objectKey.startsWith('/')) throw new Error('Invalid object key');
};

const isMissing = (error: unknown) => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
};

// Always writes to the bucket, whatever S3_MODE says. Used when moving files across.
export async function putObjectToBucket(objectKey: string, buffer: Buffer, mimeType: string, metadata?: Record<string, string>) {
  checkKey(objectKey);
  const env = getEnv();
  await s3Client().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: objectKey,
      Body: buffer,
      ContentType: mimeType,
      Metadata: metadata,
      // R2 always encrypts at rest, and rejects the AWS header. Only AWS needs it asked for.
      ...(isR2() ? {} : { ServerSideEncryption: 'AES256' as const }),
    }),
  );
}

export async function headObjectInBucket(objectKey: string): Promise<{ sizeBytes: number } | null> {
  checkKey(objectKey);
  try {
    const result = await s3Client().send(new HeadObjectCommand({ Bucket: getEnv().S3_BUCKET, Key: objectKey }));
    return { sizeBytes: Number(result.ContentLength ?? 0) };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export async function deleteObjectFromBucket(objectKey: string) {
  checkKey(objectKey);
  await s3Client().send(new DeleteObjectCommand({ Bucket: getEnv().S3_BUCKET, Key: objectKey }));
}

export type ListedObject = { key: string; sizeBytes: number; lastModified: Date | null };

// Walks every page of a listing, so a large bucket is counted in full.
export async function* listBucketObjects(prefix = ''): AsyncGenerator<ListedObject> {
  let token: string | undefined;
  do {
    const page = await s3Client().send(
      new ListObjectsV2Command({ Bucket: getEnv().S3_BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    for (const item of page.Contents ?? []) {
      if (item.Key) yield { key: item.Key, sizeBytes: Number(item.Size ?? 0), lastModified: item.LastModified ?? null };
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

export async function getObjectFromBucket(objectKey: string): Promise<Buffer> {
  checkKey(objectKey);
  const result = await s3Client().send(new GetObjectCommand({ Bucket: getEnv().S3_BUCKET, Key: objectKey }));
  if (!result.Body) throw new Error('Media object not found');
  return Buffer.from(await result.Body.transformToByteArray());
}

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

  if (storageMode() === 's3') {
    await putObjectToBucket(objectKey, buffer, mimeType, { checksum, originalFilename: safeName });
  } else {
    const target = path.join(localRoot, objectKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer, { mode: 0o600 });
  }

  return { objectKey, sizeBytes: buffer.length, checksum, mimeType };
}

export async function getPrivateMedia(objectKey: string): Promise<Buffer> {
  checkKey(objectKey);
  if (storageMode() === 's3') {
    try {
      return await getObjectFromBucket(objectKey);
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
