import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const AI_VERSION = 'ai-v1';
const AI_AAD = Buffer.from('shotlin-ai-credentials', 'utf8');

function decodeKey(raw: string | undefined, name: string): Buffer {
  if (!raw) throw new Error(`${name} is not configured`);
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes`);
  return key;
}

function masterKey(): Buffer {
  return decodeKey(process.env.WHATSAPP_AUTH_MASTER_KEY, 'WHATSAPP_AUTH_MASTER_KEY');
}

function aiMasterKey(): Buffer {
  const configured = process.env.AI_CREDENTIAL_MASTER_KEY?.trim();
  return decodeKey(
    configured || process.env.WHATSAPP_AUTH_MASTER_KEY,
    configured ? 'AI_CREDENTIAL_MASTER_KEY' : 'WHATSAPP_AUTH_MASTER_KEY',
  );
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptSecret(envelope: string): string {
  const [version, ivRaw, tagRaw, ciphertextRaw] = envelope.split('.');
  if (version !== VERSION || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error('Unsupported encrypted value');
  }
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function encryptAiSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', aiMasterKey(), iv);
  cipher.setAAD(AI_AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    AI_VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

export function decryptAiSecret(envelope: string): string {
  const [version, ivRaw, tagRaw, ciphertextRaw] = envelope.split('.');
  if (version !== AI_VERSION || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error('Unsupported AI credential');
  }
  const decipher = createDecipheriv('aes-256-gcm', aiMasterKey(), Buffer.from(ivRaw, 'base64'));
  decipher.setAAD(AI_AAD);
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
