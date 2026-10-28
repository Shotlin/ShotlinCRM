import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env.local');
} catch {
  // Deployment environments provide variables directly.
}

// Proves the bucket settings work: writes a tiny file, reads it back, then removes it.
const { deleteObjectFromBucket, getObjectFromBucket, headObjectInBucket, isR2, putObjectToBucket } = await import(
  '../src/server/storage'
);

function explain(error: unknown) {
  const e = error as { name?: string; Code?: string; code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const name = e.name ?? e.Code ?? e.code ?? '';
  const status = e.$metadata?.httpStatusCode;
  if (/NoSuchBucket/.test(name)) return 'The bucket name is wrong, or the bucket does not exist in that Cloudflare account.';
  if (/InvalidAccessKeyId|SignatureDoesNotMatch|InvalidSignature/.test(name) || status === 401) {
    return 'The Access Key ID or Secret Access Key is wrong. Check both were copied in full, with no spaces.';
  }
  if (/AccessDenied|Forbidden/.test(name) || status === 403) {
    return 'The keys work but are not allowed to write here. In Cloudflare, make the API token "Object Read & Write" for this bucket.';
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(`${name} ${e.message}`)) {
    return 'The endpoint could not be reached. Check the Account ID is right (32 characters).';
  }
  return e.message ?? String(error);
}

const key = `healthcheck/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
const payload = Buffer.from(`Shotlin CRM storage check ${new Date().toISOString()}`);
try {
  console.log(`Provider: ${isR2() ? 'Cloudflare R2' : 'S3-compatible'}`);
  await putObjectToBucket(key, payload, 'text/plain');
  console.log('PASS wrote a test file');
  const back = await getObjectFromBucket(key);
  if (!back.equals(payload)) throw new Error('The file read back is not the same as the one written.');
  console.log('PASS read it back unchanged');
  const head = await headObjectInBucket(key);
  if (head?.sizeBytes !== payload.length) throw new Error('The stored size does not match.');
  console.log('PASS size matches');
  await deleteObjectFromBucket(key);
  if (await headObjectInBucket(key)) throw new Error('The test file was not removed.');
  console.log('PASS removed the test file');
  console.log('Storage check passed.');
} catch (error) {
  console.error(`FAILED: ${explain(error)}`);
  await deleteObjectFromBucket(key).catch(() => undefined);
  process.exit(1);
}
