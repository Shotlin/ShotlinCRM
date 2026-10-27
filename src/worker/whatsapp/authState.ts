import { BufferJSON, initAuthCreds, type AuthenticationState, type SignalDataTypeMap } from '@whiskeysockets/baileys';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../server/db/client';
import { whatsappAuthState } from '../../server/db/schema';
import { decryptSecret, encryptSecret } from '../../server/security/envelope';

const CREDS_CATEGORY = 'creds';
const CREDS_KEY = 'default';

function deserialize<T>(value: string): T {
  return JSON.parse(value, BufferJSON.reviver) as T;
}

function serialize(value: unknown): string {
  return JSON.stringify(value, BufferJSON.replacer);
}

async function readValue<T>(connectionId: string, category: string, keyId: string): Promise<T | undefined> {
  const [row] = await db
    .select({ encryptedValue: whatsappAuthState.encryptedValue })
    .from(whatsappAuthState)
    .where(
      and(
        eq(whatsappAuthState.connectionId, connectionId),
        eq(whatsappAuthState.category, category),
        eq(whatsappAuthState.keyId, keyId),
      ),
    )
    .limit(1);
  return row ? deserialize<T>(decryptSecret(row.encryptedValue)) : undefined;
}

async function writeValue(connectionId: string, category: string, keyId: string, value: unknown | null) {
  if (value === null || value === undefined) {
    await db
      .delete(whatsappAuthState)
      .where(
        and(
          eq(whatsappAuthState.connectionId, connectionId),
          eq(whatsappAuthState.category, category),
          eq(whatsappAuthState.keyId, keyId),
        ),
      );
    return;
  }

  const encryptedValue = encryptSecret(serialize(value));
  await db
    .insert(whatsappAuthState)
    .values({ connectionId, category, keyId, encryptedValue })
    .onConflictDoUpdate({
      target: [
        whatsappAuthState.connectionId,
        whatsappAuthState.category,
        whatsappAuthState.keyId,
      ],
      set: {
        encryptedValue,
        revision: sql`${whatsappAuthState.revision} + 1`,
        updatedAt: new Date(),
      },
    });
}

export async function createBaileysAuthState(connectionId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const storedCreds = await readValue<AuthenticationState['creds']>(
    connectionId,
    CREDS_CATEGORY,
    CREDS_KEY,
  );
  const creds = storedCreds ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
          const rows = ids.length
            ? await db
                .select({
                  keyId: whatsappAuthState.keyId,
                  encryptedValue: whatsappAuthState.encryptedValue,
                })
                .from(whatsappAuthState)
                .where(
                  and(
                    eq(whatsappAuthState.connectionId, connectionId),
                    eq(whatsappAuthState.category, type),
                    inArray(whatsappAuthState.keyId, ids),
                  ),
                )
            : [];
          const result: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const row of rows) {
            try {
              result[row.keyId] = deserialize<SignalDataTypeMap[T]>(decryptSecret(row.encryptedValue));
            } catch {
              // Corrupt individual keys force a fresh session for that key instead of leaking data.
            }
          }
          return result;
        },
        async set(data: Partial<{ [T in keyof SignalDataTypeMap]: Record<string, SignalDataTypeMap[T] | null> }>) {
          for (const [type, values] of Object.entries(data)) {
            if (!values) continue;
            for (const [keyId, value] of Object.entries(values)) {
              await writeValue(connectionId, type, keyId, value);
            }
          }
        },
      },
    },
    saveCreds: async () => {
      await writeValue(connectionId, CREDS_CATEGORY, CREDS_KEY, creds);
    },
  };
}

export async function deleteBaileysAuthState(connectionId: string) {
  await db.delete(whatsappAuthState).where(eq(whatsappAuthState.connectionId, connectionId));
}
