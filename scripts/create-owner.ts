import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env.local');
} catch {
  // Deployment environments provide variables directly.
}

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const email = option('--email') ?? process.env.OWNER_EMAIL;
const name = option('--name') ?? process.env.OWNER_NAME;
const password = option('--password') ?? process.env.OWNER_PASSWORD;

if (!email || !name || !password || password.length < 12) {
  throw new Error(
    'Usage: npm run auth:create-owner -- --email you@example.com --name "Your Name" --password "at-least-12-characters"',
  );
}

const { ensureUserAndWorkspace, seedDemoCrm } = await import('../src/server/services/crm/seed');
const { pool } = await import('../src/server/db/client');
const owner = await ensureUserAndWorkspace({ email, name, password });
if (args.includes('--demo')) await seedDemoCrm(owner.workspaceId);
console.log(`${owner.created ? 'Created' : 'Found existing'} owner account: ${email}`);
await pool.end();
