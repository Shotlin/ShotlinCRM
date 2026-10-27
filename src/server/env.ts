import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://127.0.0.1:6379'),
  AUTH_SECRET: z.string().min(32),
  AUTH_URL: z.string().url().default('http://127.0.0.1:3000'),
  WHATSAPP_AUTH_MASTER_KEY: z.string().min(32),
  AI_CREDENTIAL_MASTER_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32).optional(),
  ),
  S3_ENDPOINT: z.string().url().default('http://127.0.0.1:59000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('shotlin-media'),
  S3_ACCESS_KEY: z.string().default('shotlin-local'),
  S3_SECRET_KEY: z.string().default('shotlin-local-secret'),
  S3_FORCE_PATH_STYLE: z.string().optional(),
  META_GRAPH_VERSION: z.string().default('v23.0'),
  META_APP_SECRET: z.string().optional(),
  OWNER_EMAIL: z.string().email().optional(),
  OWNER_PASSWORD: z.string().min(12).optional(),
  OWNER_NAME: z.string().default('Owner'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type AppEnv = z.infer<typeof envSchema>;

export function getEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment configuration: ${Object.keys(fields).join(', ')}`);
  }
  return parsed.data;
}
