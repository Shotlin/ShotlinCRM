import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyMetaSignature } from './signature';

const appSecret = 'test-meta-app-secret';
const body = JSON.stringify({ object: 'page', entry: [] });
const signature = `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`;

describe('Meta webhook signatures', () => {
  it('accepts the exact raw payload signed by the configured app', () => {
    expect(verifyMetaSignature(body, signature, appSecret)).toBe(true);
  });

  it('rejects modified payloads and malformed signatures', () => {
    expect(verifyMetaSignature(`${body} `, signature, appSecret)).toBe(false);
    expect(verifyMetaSignature(body, 'sha256=abc', appSecret)).toBe(false);
    expect(verifyMetaSignature(body, signature, undefined)).toBe(false);
  });
});
