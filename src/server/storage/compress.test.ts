import { describe, expect, it } from 'vitest';
import { optimizeMedia } from './compress';

describe('media compression', () => {
  it('turns a big received photo into a much smaller WebP', async () => {
    const { default: sharp } = await import('sharp');
    const noise = Buffer.alloc(3000 * 2000 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919) % 251;
    const jpeg = await sharp(noise, { raw: { width: 3000, height: 2000, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
    const out = await optimizeMedia(jpeg, 'image/jpeg', 'received');
    expect(out.mimeType).toBe('image/webp');
    expect(out.buffer.length).toBeLessThan(jpeg.length / 2);
    const meta = await sharp(out.buffer).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1600);
  });
  it('keeps JPEG for files sent on to WhatsApp', async () => {
    const { default: sharp } = await import('sharp');
    const jpeg = await sharp({ create: { width: 2400, height: 2400, channels: 3, background: '#336699' } }).jpeg({ quality: 100 }).toBuffer();
    const out = await optimizeMedia(jpeg, 'image/jpeg', 'outgoing');
    expect(out.mimeType).toBe('image/jpeg');
  });
  it('never fails on a file it cannot read', async () => {
    const junk = Buffer.from('not an image');
    expect((await optimizeMedia(junk, 'image/png', 'received')).buffer).toBe(junk);
    expect((await optimizeMedia(junk, 'application/pdf', 'received')).buffer).toBe(junk);
  });
});
