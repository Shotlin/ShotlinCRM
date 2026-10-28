import { describe, expect, it } from 'vitest';
import type { WAMessage } from '@whiskeysockets/baileys';
import { normalizeWhatsAppMessage } from './normalize';

const message = (key: Partial<WAMessage['key']>, text = 'hello'): WAMessage => ({
  key: { id: 'ABC', fromMe: false, ...key },
  message: { conversation: text },
  messageTimestamp: 1_700_000_000,
});

describe('normalizeWhatsAppMessage', () => {
  it('reads the phone number from a phone-number chat id', () => {
    const result = normalizeWhatsAppMessage(message({ remoteJid: '919876543210@s.whatsapp.net' }));
    expect(result).toMatchObject({ phone: '919876543210', fromMe: false, body: 'hello', kind: 'text' });
  });

  it('never uses an opaque @lid id as a phone number', () => {
    expect(normalizeWhatsAppMessage(message({ remoteJid: '85401733705851@lid' }))).toBeNull();
  });

  it('uses the resolved phone number for an @lid chat', () => {
    const result = normalizeWhatsAppMessage(
      message({ remoteJid: '85401733705851@lid' }),
      '919876543210@s.whatsapp.net',
    );
    expect(result).toMatchObject({ phone: '919876543210', remoteJid: '85401733705851@lid' });
  });

  it('keeps messages typed on the phone and marks them as sent by us', () => {
    const result = normalizeWhatsAppMessage(
      message({ remoteJid: '919876543210@s.whatsapp.net', fromMe: true }, 'from my phone'),
    );
    expect(result).toMatchObject({ fromMe: true, body: 'from my phone' });
  });

  it('ignores groups, status updates and non-chat protocol messages', () => {
    expect(normalizeWhatsAppMessage(message({ remoteJid: '1203630@g.us' }))).toBeNull();
    expect(normalizeWhatsAppMessage(message({ remoteJid: 'status@broadcast' }))).toBeNull();
    expect(
      normalizeWhatsAppMessage({
        key: { id: 'P', remoteJid: '919876543210@s.whatsapp.net', fromMe: true },
        message: { protocolMessage: {} },
      }),
    ).toBeNull();
  });
});
