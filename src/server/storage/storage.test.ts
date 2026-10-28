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
  S3_BUCKET: 'env-bucket',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
});

type Storage = typeof import('./index');

async function load(env: Record<string, string> = {}): Promise<Storage> {
  vi.resetModules();
  for (const [name, value] of Object.entries({ ...baseEnv(), ...env })) vi.stubEnv(name, value);
  const storage = await import('./index');
  storage.setSavedConnectionLoader(async () => null);
  return storage;
}

const bucket = (over: Partial<import('./index').BucketConfig> = {}): import('./index').BucketConfig => ({
  endpoint,
  region: 'auto',
  bucket: 'test-bucket',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
  forcePathStyle: true,
  provider: 'r2',
  ...over,
});

beforeEach(() => {
  objects.clear();
  requests = [];
  lastPutHeaders = {};
  vi.unstubAllEnvs();
});

describe('talking to a bucket', () => {
  it('saves, checks, lists and removes objects', async () => {
    const storage = await load();
    const config = bucket();
    await storage.putObjectToBucket(config, 'docs/a.pdf', Buffer.from('12345'), 'application/pdf');
    expect(objects.get('docs/a.pdf')?.type).toBe('application/pdf');
    expect((await storage.getObjectFromBucket(config, 'docs/a.pdf')).toString()).toBe('12345');
    expect(await storage.headObjectInBucket(config, 'docs/a.pdf')).toEqual({ sizeBytes: 5 });
    expect(await storage.headObjectInBucket(config, 'docs/missing.pdf')).toBeNull();
    await storage.deleteObjectFromBucket(config, 'docs/a.pdf');
    expect(await storage.headObjectInBucket(config, 'docs/a.pdf')).toBeNull();
  });

  it('does not send the AWS-only encryption header to R2, but does to AWS', async () => {
    const storage = await load();
    await storage.putObjectToBucket(bucket({ provider: 'r2' }), 'a/one.txt', Buffer.from('x'), 'text/plain');
    expect(lastPutHeaders['x-amz-server-side-encryption']).toBeUndefined();
    await storage.putObjectToBucket(bucket({ provider: 'aws' }), 'a/two.txt', Buffer.from('x'), 'text/plain');
    expect(lastPutHeaders['x-amz-server-side-encryption']).toBe('AES256');
  });

  it('recognises an R2 address in the server settings without being told', async () => {
    const r2 = await load({ S3_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com' });
    expect(r2.envBucketConfig().provider).toBe('r2');
    const other = await load({ S3_ENDPOINT: 'https://s3.amazonaws.com' });
    expect(other.envBucketConfig().provider).toBe('other');
  });

  it('lists every page of a large listing, and only the prefix asked for', async () => {
    const storage = await load();
    const config = bucket();
    for (let i = 1; i <= 5; i++) await storage.putObjectToBucket(config, `backups/db-${i}.dump`, Buffer.from('1234567890'.slice(0, i)), 'application/octet-stream');
    await storage.putObjectToBucket(config, 'media/photo.png', Buffer.from('ab'), 'image/png');
    const backups: string[] = [];
    let bytes = 0;
    for await (const item of storage.listBucketObjects(config, 'backups/')) {
      backups.push(item.key);
      bytes += item.sizeBytes;
    }
    expect(backups).toHaveLength(5);
    expect(bytes).toBe(1 + 2 + 3 + 4 + 5);
    const all: string[] = [];
    for await (const item of storage.listBucketObjects(config)) all.push(item.key);
    expect(all).toHaveLength(6);
  });

  it('refuses unsafe object keys everywhere', async () => {
    const storage = await load();
    for (const bad of ['../secrets', 'a/../b', '/absolute', '']) {
      await expect(storage.getPrivateMedia(bad)).rejects.toThrow(/Invalid object key/);
      await expect(storage.putObjectToBucket(bucket(), bad, Buffer.from('x'), 'text/plain')).rejects.toThrow(/Invalid object key/);
      await expect(storage.deleteObjectFromBucket(bucket(), bad)).rejects.toThrow(/Invalid object key/);
    }
    expect(requests).toHaveLength(0);
  });
});

describe('where a workspace keeps its files', () => {
  it('uses the bucket saved in the CRM when there is one', async () => {
    const storage = await load();
    storage.setSavedConnectionLoader(async () => ({ config: bucket({ bucket: 'saved-bucket' }), limitGb: 7 }));
    const resolved = await storage.resolveStorage('ws1');
    expect(resolved).toMatchObject({ mode: 's3', source: 'settings', limitGb: 7 });
  });

  it('lets the saved connection win over the server settings file', async () => {
    const storage = await load({ S3_MODE: 's3', STORAGE_LIMIT_GB: '3' });
    storage.setSavedConnectionLoader(async () => ({ config: bucket({ bucket: 'saved-bucket' }), limitGb: 7 }));
    const resolved = await storage.resolveStorage('ws1');
    expect(resolved).toMatchObject({ source: 'settings', limitGb: 7 });
    if (resolved.mode === 's3') expect(resolved.config.bucket).toBe('saved-bucket');
  });

  it('falls back to the server settings file, then to local disk', async () => {
    const env = await load({ S3_MODE: 's3', STORAGE_LIMIT_GB: '3' });
    const fromEnv = await env.resolveStorage('ws1');
    expect(fromEnv).toMatchObject({ mode: 's3', source: 'env', limitGb: 3 });
    const local = await load({ S3_MODE: 'local' });
    expect(await local.resolveStorage('ws1')).toEqual({ mode: 'local' });
  });

  it('picks up a change within seconds without a restart, and not before', async () => {
    const storage = await load();
    let saved: import('./index').SavedConnection | null = null;
    let lookups = 0;
    storage.setSavedConnectionLoader(async () => {
      lookups += 1;
      return saved;
    });
    expect((await storage.resolveStorage('ws1')).mode).toBe('local');
    saved = { config: bucket(), limitGb: 10 };
    expect((await storage.resolveStorage('ws1')).mode).toBe('local');
    expect(lookups).toBe(1);
    storage.clearStorageCache('ws1');
    expect((await storage.resolveStorage('ws1')).mode).toBe('s3');
    expect(lookups).toBe(2);
  });

  it('keeps one workspace on its bucket while another stays on local disk', async () => {
    const storage = await load();
    storage.setSavedConnectionLoader(async (workspaceId) => (workspaceId === 'wsA' ? { config: bucket(), limitGb: 10 } : null));
    const a = await storage.putPrivateMedia({ workspaceId: 'wsA', buffer: Buffer.from('in-bucket'), mimeType: 'image/png' });
    expect(objects.get(a.objectKey)?.body.toString()).toBe('in-bucket');
    expect(storage.workspaceOfKey(a.objectKey)).toBe('wsA');
    expect((await storage.getPrivateMedia(a.objectKey)).toString()).toBe('in-bucket');
    const b = await storage.putPrivateMedia({ workspaceId: `wsB-${process.pid}`, buffer: Buffer.from('on-disk'), mimeType: 'image/png' });
    expect(objects.has(b.objectKey)).toBe(false);
    expect((await storage.getPrivateMedia(b.objectKey)).toString()).toBe('on-disk');
    await rm(path.join(process.cwd(), '.local', 'media', `wsB-${process.pid}`), { recursive: true, force: true });
  });
});

describe('moving from local disk to the bucket', () => {
  const ws = `test-ws-${process.pid}`;
  const key = `${ws}/legacy.png`;
  const file = path.join(process.cwd(), '.local', 'media', key);

  afterAll(async () => {
    await rm(path.dirname(file), { recursive: true, force: true });
  });

  const withBucket = async () => {
    const storage = await load();
    storage.setSavedConnectionLoader(async () => ({ config: bucket(), limitGb: 10 }));
    return storage;
  };

  it('still serves a file that has not been moved yet', async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'old-local-bytes');
    const storage = await withBucket();
    expect((await storage.getPrivateMedia(key)).toString()).toBe('old-local-bytes');
  });

  it('prefers the bucket once the file is there', async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'old-local-bytes');
    const storage = await withBucket();
    await storage.putObjectToBucket(bucket(), key, Buffer.from('bucket-bytes'), 'image/png');
    expect((await storage.getPrivateMedia(key)).toString()).toBe('bucket-bytes');
  });

  it('does not hide a real bucket error behind the local copy', async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'old-local-bytes');
    const storage = await load();
    storage.setSavedConnectionLoader(async () => ({ config: bucket({ endpoint: 'http://127.0.0.1:1' }), limitGb: 10 }));
    await expect(storage.getPrivateMedia(key)).rejects.toThrow();
  });
});
