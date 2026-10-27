import { loadEnvFile } from 'node:process';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

try {
  loadEnvFile('.env.local');
} catch {
  // Deployment environments provide variables directly.
}

const { db, pool } = await import('../src/server/db/client');

await migrate(db, { migrationsFolder: './drizzle' });
await pool.end();
console.log('Database migrations applied.');
