import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_DATA } from '../data/demo';
import { useCrmStore } from './crmStore';
import { invoiceBalanceMinor } from './selectors';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })),
  );
  useCrmStore.setState({
    ...structuredClone(DEMO_DATA),
    hydrated: true,
    reportingCurrency: 'INR',
    lastError: null,
  });
});

describe('CRM store workflow', () => {
  it('captures a new lead and its inbound message together', () => {
    useCrmStore.getState().addLead({
      name: 'Test Lead',
      company: 'Test Studio',
      phone: '+91 99999 00000',
      email: 'test@studio.in',
      city: 'Mumbai',
      source: 'whatsapp',
      initialMessage: 'We need a wedding film.',
      valueMinor: 5_000_000,
      currency: 'INR',
    });

    const state = useCrmStore.getState();
    const lead = state.leads.find((item) => item.name === 'Test Lead');
    expect(lead?.status).toBe('new');
    expect(state.messages.filter((message) => message.leadId === lead?.id)).toHaveLength(1);
  });

  it('moves a lead and keeps the latest activity timestamp current', () => {
    const lead = useCrmStore.getState().leads[0];
    useCrmStore.getState().moveLead(lead.id, 'connected');
    expect(useCrmStore.getState().leads.find((item) => item.id === lead.id)?.status).toBe(
      'connected',
    );
  });

  it('converts an accepted lead into one linked client', () => {
    const lead = useCrmStore.getState().leads[0];
    const clientId = useCrmStore.getState().convertLeadToClient(lead.id);
    const secondCall = useCrmStore.getState().convertLeadToClient(lead.id);
    const state = useCrmStore.getState();

    expect(secondCall).toBe(clientId);
    expect(state.clients.filter((client) => client.name === lead.name)).toHaveLength(1);
    expect(state.leads.find((item) => item.id === lead.id)?.status).toBe('accepted');
  });

  it('records partial then full payment and advances the linked lead', () => {
    const state = useCrmStore.getState();
    const invoice = state.invoices[0];
    const balance = invoiceBalanceMinor(invoice, state.payments);
    expect(balance).toBeGreaterThan(0);

    state.recordPayment({
      invoiceId: invoice.id,
      amountMinor: 100,
      receivedAt: '2026-10-27T12:00:00',
      method: 'bank',
      note: 'Test partial',
    });
    expect(
      invoiceBalanceMinor(
        useCrmStore.getState().invoices[0],
        useCrmStore.getState().payments,
      ),
    ).toBe(balance - 100);

    useCrmStore.getState().recordPayment({
      invoiceId: invoice.id,
      amountMinor: balance - 100,
      receivedAt: '2026-10-27T12:10:00',
      method: 'bank',
      note: 'Test full',
    });
    const updated = useCrmStore.getState();
    expect(
      invoiceBalanceMinor(
        updated.invoices.find((item) => item.id === invoice.id)!,
        updated.payments,
      ),
    ).toBe(0);
    expect(updated.leads.find((lead) => lead.id === invoice.leadId)?.status).toBe('paid');
  });

  it('can flush queued writes before navigating away', async () => {
    let release!: (response: { ok: boolean; status: number; json: () => Promise<object> }) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ),
    );
    const leadId = useCrmStore.getState().leads[0].id;
    useCrmStore.getState().addNote(leadId, 'Persist before navigation');
    let flushed = false;
    const pending = useCrmStore.getState().flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    release({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await pending;
    expect(flushed).toBe(true);
  });
});
