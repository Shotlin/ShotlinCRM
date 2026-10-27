import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { getEnv } from '../env';
import * as schema from './schema';

const globalForDb = globalThis as unknown as {
  shotlinPool?: pg.Pool;
};

export const pool =
  globalForDb.shotlinPool ??
  new pg.Pool({
    connectionString: getEnv().DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== 'production') globalForDb.shotlinPool = pool;

export const db = drizzle(pool, { schema });
export type Database = typeof db;
