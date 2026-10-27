import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

function s3Client() {
  if (!s3) {
    const env = getEnv();
    s3 = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    });
  }
  return s3;
}

const storageMode = () => process.env.S3_MODE ?? 'local';

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
    const env = getEnv();
    await s3Client().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: objectKey,
        Body: buffer,
        ContentType: mimeType,
        Metadata: { checksum, originalFilename: safeName },
        ServerSideEncryption: 'AES256',
      }),
    );
  } else {
    const target = path.join(localRoot, objectKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer, { mode: 0o600 });
  }

  return { objectKey, sizeBytes: buffer.length, checksum, mimeType };
}

export async function getPrivateMedia(objectKey: string): Promise<Buffer> {
  if (!objectKey || objectKey.includes('..')) throw new Error('Invalid object key');
  if (storageMode() === 's3') {
    const env = getEnv();
    const result = await s3Client().send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey }),
    );
    if (!result.Body) throw new Error('Media object not found');
    return Buffer.from(await result.Body.transformToByteArray());
  }
  return readFile(path.join(localRoot, objectKey));
}

export function mediaKindFor(mimeType: string): 'image' | 'video' | 'audio' | 'document' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}
