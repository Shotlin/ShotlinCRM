import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env.local');
} catch {
  // Deployment environments provide variables directly.
}

const { getEnv } = await import('../src/server/env');
const { pool } = await import('../src/server/db/client');
const { ensureUserAndWorkspace, seedDemoCrm } = await import('../src/server/services/crm/seed');

const env = getEnv();
if (!env.OWNER_EMAIL || !env.OWNER_PASSWORD) {
  throw new Error('Set OWNER_EMAIL and OWNER_PASSWORD before seeding.');
}

const owner = await ensureUserAndWorkspace({
  email: env.OWNER_EMAIL,
  name: env.OWNER_NAME,
  password: env.OWNER_PASSWORD,
});
const result = await seedDemoCrm(owner.workspaceId);
console.log(result.seeded ? 'Workspace seeded with demo CRM data.' : 'Workspace already contains CRM data.');
console.log(`Owner: ${env.OWNER_EMAIL}`);
await pool.end();
