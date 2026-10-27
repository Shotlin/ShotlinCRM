import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function hashVerifyToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function verifyMetaSignature(rawBody: string, signature: string | null, appSecret: string | undefined) {
  if (!signature?.startsWith('sha256=') || !appSecret) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature.slice(7), 'hex');
  } catch {
    return false;
  }
  return received.length === expected.length && timingSafeEqual(received, expected);
}
