import { beforeEach, describe, expect, it } from 'vitest';
import { decryptAiSecret, decryptSecret, encryptAiSecret, encryptSecret } from './envelope';

beforeEach(() => {
  process.env.WHATSAPP_AUTH_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
  delete process.env.AI_CREDENTIAL_MASTER_KEY;
});

describe('encrypted integration secrets', () => {
  it('round-trips a serialized Baileys key', () => {
    const value = JSON.stringify({ type: 'Buffer', data: [1, 2, 3], name: 'creds' });
    const encrypted = encryptSecret(value);
    expect(encrypted).not.toContain('creds');
    expect(decryptSecret(encrypted)).toBe(value);
  });

  it('rejects tampered ciphertext', () => {
    const encrypted = encryptSecret('private session material');
    const parts = encrypted.split('.');
    const tampered = [parts[0], parts[1], parts[2], Buffer.from('other').toString('base64')].join('.');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('uses a fresh IV for each encryption', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('keeps AI credentials separate from generic encrypted values', () => {
    const value = 'sk-live-secret';
    const encrypted = encryptAiSecret(value);
    expect(encrypted).not.toContain(value);
    expect(decryptAiSecret(encrypted)).toBe(value);
    expect(() => decryptSecret(encrypted)).toThrow();
    expect(() => decryptAiSecret(encryptSecret(value))).toThrow();
  });
});
