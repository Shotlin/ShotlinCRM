import { mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for an S3-style bucket such as Cloudflare R2, reachable over HTTP on this machine.
type Stored = { body: Buffer; type: string };
const objects = new Map<string, Stored>();
let lastPutHeaders: http.IncomingHttpHeaders = {};
let requests: string[] = [];
let server: http.Server;
let endpoint = '';
const PAGE = 2;

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const key = parts.slice(1).map(decodeURIComponent).join('/');
    requests.push(`${req.method} ${key || '(list)'}`);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);

    if (req.method === 'PUT') {
      lastPutHeaders = req.headers;
      objects.set(key, { body, type: String(req.headers['content-type'] ?? '') });
      res.writeHead(200, { ETag: '"x"' }).end();
    } else if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const start = Number(url.searchParams.get('continuation-token') ?? 0);
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const slice = keys.slice(start, start + PAGE);
      const more = start + PAGE < keys.length;
      const xml =
        `<?xml version="1.0"?><ListBucketResult><IsTruncated>${more}</IsTruncated>` +
        (more ? `<NextContinuationToken>${start + PAGE}</NextContinuationToken>` : '') +
        slice
          .map((k) => `<Contents><Key>${k}</Key><Size>${objects.get(k)!.body.length}</Size><LastModified>2026-10-01T00:00:00.000Z</LastModified></Contents>`)
          .join('') +
        '</ListBucketResult>';
      res.writeHead(200, { 'Content-Type': 'application/xml' }).end(xml);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      const found = objects.get(key);
      if (!found) {
        res.writeHead(404, { 'Content-Type': 'application/xml' }).end('<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>');
      } else {
        res.writeHead(200, { 'Content-Length': found.body.length, 'Content-Type': found.type });
        res.end(req.method === 'HEAD' ? undefined : found.body);
      }
    } else if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204).end();
    } else {
      res.writeHead(405).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

const baseEnv = () => ({
  DATABASE_URL: 'postgresql://x:x@127.0.0.1:5432/x',
  AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  WHATSAPP_AUTH_MASTER_KEY: 'test-master-key-that-is-at-least-32-characters',
  S3_ENDPOINT: endpoint,
  S3_REGION: 'auto',
  S3_BUCKET: 'test-bucket',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
});

async function load(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const [name, value] of Object.entries({ ...baseEnv(), S3_MODE: 's3', S3_PROVIDER: 'r2', ...env })) {
    vi.stubEnv(name, value);
  }
  return import('./index');
}

beforeEach(() => {
  objects.clear();
  requests = [];
  lastPutHeaders = {};
  vi.unstubAllEnvs();
});

describe('bucket storage', () => {
  it('stores and returns a file through the bucket', async () => {
    const storage = await load();
    const stored = await storage.putPrivateMedia({ workspaceId: 'ws1', buffer: Buffer.from('photo-bytes'), mimeType: 'image/png', filename: 'a.png' });
    expect(stored.objectKey).toMatch(/^ws1\/[0-9a-f-]{36}\.png$/);
    const inBucket = objects.get(stored.objectKey);
    expect(inBucket?.body.toString()).toBe('photo-bytes');
    expect(inBucket?.type).toBe('image/png');
    expect((await storage.getPrivateMedia(stored.objectKey)).toString()).toBe('photo-bytes');
  });

  it('does not send the AWS-only encryption header to R2, but does to AWS', async () => {
    const r2 = await load({ S3_PROVIDER: 'r2' });
    await r2.putObjectToBucket('a/one.txt', Buffer.from('x'), 'text/plain');
    expect(lastPutHeaders['x-amz-server-side-encryption']).toBeUndefined();

    const aws = await load({ S3_PROVIDER: 'aws' });
    await aws.putObjectToBucket('a/two.txt', Buffer.from('x'), 'text/plain');
    expect(lastPutHeaders['x-amz-server-side-encryption']).toBe('AES256');
  });

  it('recognises an R2 address without being told', async () => {
    const storage = await load({ S3_PROVIDER: '', S3_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com' });
    expect(storage.isR2()).toBe(true);
    const other = await load({ S3_PROVIDER: '', S3_ENDPOINT: 'https://s3.amazonaws.com' });
    expect(other.isR2()).toBe(false);
  });

  it('checks whether an object exists, with its size', async () => {
    const storage = await load();
    await storage.putObjectToBucket('docs/a.pdf', Buffer.from('12345'), 'application/pdf');
    expect(await storage.headObjectInBucket('docs/a.pdf')).toEqual({ sizeBytes: 5 });
    expect(await storage.headObjectInBucket('docs/missing.pdf')).toBeNull();
  });

  it('removes an object', async () => {
    const storage = await load();
    await storage.putObjectToBucket('tmp/a.txt', Buffer.from('x'), 'text/plain');
    await storage.deleteObjectFromBucket('tmp/a.txt');
    expect(await storage.headObjectInBucket('tmp/a.txt')).toBeNull();
  });

  it('lists every page of a large listing, and only the prefix asked for', async () => {
    const storage = await load();
    for (let i = 1; i <= 5; i++) await storage.putObjectToBucket(`backups/db-${i}.dump`, Buffer.from('1234567890'.slice(0, i)), 'application/octet-stream');
    await storage.putObjectToBucket('media/photo.png', Buffer.from('ab'), 'image/png');

    const backups: string[] = [];
    let bytes = 0;
    for await (const item of storage.listBucketObjects('backups/')) {
      backups.push(item.key);
      bytes += item.sizeBytes;
    }
    expect(backups).toEqual(['backups/db-1.dump', 'backups/db-2.dump', 'backups/db-3.dump', 'backups/db-4.dump', 'backups/db-5.dump']);
    expect(bytes).toBe(1 + 2 + 3 + 4 + 5);

    const all: string[] = [];
    for await (const item of storage.listBucketObjects()) all.push(item.key);
    expect(all).toHaveLength(6);
  });

  it('refuses unsafe object keys everywhere', async () => {
    const storage = await load();
    for (const bad of ['../secrets', 'a/../b', '/absolute', '']) {
      await expect(storage.getPrivateMedia(bad)).rejects.toThrow(/Invalid object key/);
      await expect(storage.putObjectToBucket(bad, Buffer.from('x'), 'text/plain')).rejects.toThrow(/Invalid object key/);
      await expect(storage.deleteObjectFromBucket(bad)).rejects.toThrow(/Invalid object key/);
    }
    expect(requests).toHaveLength(0);
  });
});

describe('moving from local disk to the bucket', () => {
  const key = `test-ws-${process.pid}/legacy.png`;
  const file = path.join(process.cwd(), '.local', 'media', key);

  afterAll(async () => {
    await rm(path.dirname(file), { recursive: true, force: true });
  });

  it('still serves a file that has not been moved yet', async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'old-local-bytes');
    const storage = await load();
    expect((await storage.getPrivateMedia(key)).toString()).toBe('old-local-bytes');
  });

  it('prefers the bucket once the file is there', async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'old-local-bytes');
    const storage = await load();
    await storage.putObjectToBucket(key, Buffer.from('bucket-bytes'), 'image/png');
    expect((await storage.getPrivateMedia(key)).toString()).toBe('bucket-bytes');
  });

  it('keeps using local disk, never the bucket, when S3_MODE is local', async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'old-local-bytes');
    const storage = await load({ S3_MODE: 'local' });
    requests = [];
    expect((await storage.getPrivateMedia(key)).toString()).toBe('old-local-bytes');
    const stored = await storage.putPrivateMedia({ workspaceId: `test-ws-${process.pid}`, buffer: Buffer.from('new'), mimeType: 'image/png' });
    expect(objects.size).toBe(0);
    expect(requests).toHaveLength(0);
    await rm(path.join(process.cwd(), '.local', 'media', stored.objectKey), { force: true });
  });

  it('does not hide a real bucket error behind the local copy', async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'old-local-bytes');
    const storage = await load({ S3_ENDPOINT: 'http://127.0.0.1:1' });
    await expect(storage.getPrivateMedia(key)).rejects.toThrow();
  });
});
