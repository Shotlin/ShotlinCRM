import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env.local');
} catch {
  // Deployment environments provide variables directly.
}

// Checks the bucket described in the server's settings file (S3_* values): saves a tiny file,
// reads it back, then removes it. The CRM's Storage settings screen runs the same check.
const { envBucketConfig } = await import('../src/server/storage');
const { testBucket } = await import('../src/server/storage/connection');

const config = envBucketConfig();
console.log(`Provider: ${config.provider === 'r2' ? 'Cloudflare R2' : 'S3-compatible'}`);
const { ok, steps } = await testBucket(config);
for (const step of steps) console.log(`${step.ok ? 'PASS' : 'FAIL'} ${step.name}${step.message ? ` - ${step.message}` : ''}`);
if (!ok) {
  console.error('FAILED: the bucket check did not pass.');
  process.exit(1);
}
console.log('Storage check passed.');
process.exit(0);
