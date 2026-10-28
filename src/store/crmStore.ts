import { addDays, format } from 'date-fns';
import { create } from 'zustand';
import type { CrmAction } from '../data/api';
import type {
  CalendarEvent,
  Client,
  CrmData,
  Currency,
  Invoice,
  Lead,
  LeadNote,
  LeadStatus,
  Message,
  Payment,
  PaymentMethod,
  Proposal,
  ProposalStatus,
} from '../data/types';

type LeadInput = Pick<
  Lead,
  'name' | 'company' | 'phone' | 'email' | 'city' | 'source' | 'initialMessage' | 'valueMinor' | 'currency'
> & { followUpAt?: string };

type ClientInput = Pick<Client, 'name' | 'company' | 'email' | 'phone' | 'city'>;

type PaymentInput = {
  invoiceId: string;
  amountMinor: number;
  receivedAt: string;
  method: PaymentMethod;
  note: string;
};

type EventInput = Pick<CalendarEvent, 'title' | 'startsAt' | 'endsAt' | 'type'> & {
  leadId?: string;
  clientId?: string;
  href?: string;
};

type CrmSnapshot = CrmData & {
  reportingCurrency: Currency;
  workspaceName?: string;
};

type CrmStore = CrmData & {
  hydrated: boolean;
  reportingCurrency: Currency;
  lastError: string | null;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  flush: () => Promise<void>;
  sendMessage: (
    leadId: string,
    body: string,
    options?: { templateId?: string; file?: File },
  ) => Promise<string>;
  clearError: () => void;
  setReportingCurrency: (currency: Currency) => void;
  addLead: (input: LeadInput) => Lead;
  updateLead: (id: string, patch: Partial<Lead>) => void;
  moveLead: (id: string, status: LeadStatus) => void;
  addNote: (leadId: string, body: string) => void;
  addClient: (input: ClientInput) => Client;
  updateClient: (id: string, patch: Partial<Client>) => void;
  convertLeadToClient: (leadId: string) => string;
  createProposal: (seed?: Partial<Proposal>) => Proposal;
  updateProposal: (id: string, patch: Partial<Proposal>) => void;
  setProposalStatus: (id: string, status: ProposalStatus) => void;
  createInvoice: (seed?: Partial<Invoice>) => Invoice;
  updateInvoice: (id: string, patch: Partial<Invoice>) => void;
  recordPayment: (input: PaymentInput) => void;
  addEvent: (input: EventInput) => void;
};

const emptyData: CrmData = {
  leads: [],
  chats: [],
  messages: [],
  clients: [],
  proposals: [],
  invoices: [],
  payments: [],
  notes: [],
  events: [],
};

const id = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID()}`;
const nowIso = () => new Date().toISOString();
const normalizeFollowUp = (value?: string) =>
  value ? new Date(value).toISOString() : undefined;

let mutationQueue: Promise<void> = Promise.resolve();
let hydrationPromise: Promise<void> | null = null;

async function fetchSnapshot(): Promise<CrmSnapshot> {
  const response = await fetch('/api/crm', { cache: 'no-store' });
  if (response.status === 401) {
    throw new Error('Your session expired. Sign in again to continue.');
  }
  if (!response.ok) throw new Error('The CRM could not be loaded');
  return (await response.json()) as CrmSnapshot;
}

export const useCrmStore = create<CrmStore>()((set, get) => {
  const send = (action: CrmAction) => {
    mutationQueue = mutationQueue
      .then(async () => {
        const response = await fetch('/api/crm/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action),
          keepalive: true,
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? 'The change could not be saved');
        }
      })
      .catch(async (error: unknown) => {
        set({ lastError: error instanceof Error ? error.message : 'The change could not be saved' });
        try {
          const snapshot = await fetchSnapshot();
          set({ ...snapshot });
        } catch {
          // The mutation error is already visible; hydration retries on reload.
        }
      });
  };

  const hydrate = async () => {
    if (hydrationPromise) return hydrationPromise;
    hydrationPromise = fetchSnapshot()
      .then((snapshot) => {
        set({ ...snapshot, hydrated: true, lastError: null });
      })
      .catch((error: unknown) => {
        hydrationPromise = null;
        throw error;
      });
    return hydrationPromise;
  };

  return {
    ...emptyData,
    hydrated: false,
    reportingCurrency: 'INR',
    lastError: null,
    hydrate,
    refresh: async () => {
      const snapshot = await fetchSnapshot();
      set({ ...snapshot, hydrated: true, lastError: null });
    },
    flush: () => mutationQueue,
    sendMessage: async (leadId, body, options = {}) => {
      const clientIdempotencyKey = globalThis.crypto.randomUUID();
      let response: Response;
      if (options.file) {
        const form = new FormData();
        form.set('leadId', leadId);
        form.set('body', body);
        form.set('file', options.file);
        form.set('clientIdempotencyKey', clientIdempotencyKey);
        if (options.templateId) form.set('templateId', options.templateId);
        response = await fetch('/api/messages/media', { method: 'POST', body: form });
      } else {
        response = await fetch('/api/messages/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leadId,
            body,
            templateId: options.templateId,
            clientIdempotencyKey,
          }),
        });
      }
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; messageId?: string }
        | null;
      if (!response.ok) throw new Error(payload?.error ?? 'Message could not be queued');
      await get().refresh();
      return payload?.messageId ?? '';
    },
    clearError: () => set({ lastError: null }),

    setReportingCurrency: (reportingCurrency) => {
      set({ reportingCurrency });
      send({ type: 'settings.reportingCurrency', payload: { currency: reportingCurrency } });
    },

    addLead: (input) => {
      const timestamp = nowIso();
      const lead: Lead = {
        ...input,
        followUpAt: normalizeFollowUp(input.followUpAt),
        id: id('lead'),
        status: 'new',
        ownerInitials: 'SR',
        createdAt: timestamp,
        lastActivityAt: timestamp,
        tags: [],
      };
      const message: Message = {
        id: id('message'),
        leadId: lead.id,
        direction: 'inbound',
        body: input.initialMessage,
        sentAt: timestamp,
        source: input.source,
        state: 'sample',
      };
      set((state) => ({
        leads: [lead, ...state.leads],
        messages: [...state.messages, message],
      }));
      send({ type: 'lead.create', payload: { lead, message } });
      return lead;
    },

    updateLead: (leadId, patch) => {
      const normalized = { ...patch, ...(patch.followUpAt !== undefined ? { followUpAt: normalizeFollowUp(patch.followUpAt) } : {}) };
      set((state) => ({
        leads: state.leads.map((lead) => (lead.id === leadId ? { ...lead, ...normalized } : lead)),
      }));
      send({ type: 'lead.update', payload: { id: leadId, patch: normalized } });
    },

    moveLead: (leadId, status) => {
      const updatedAt = nowIso();
      set((state) => ({
        leads: state.leads.map((lead) =>
          lead.id === leadId ? { ...lead, status, lastActivityAt: updatedAt } : lead,
        ),
      }));
      send({ type: 'lead.move', payload: { id: leadId, status } });
    },

    addNote: (leadId, body) => {
      const note: LeadNote = { id: id('note'), leadId, body, createdAt: nowIso() };
      set((state) => ({ notes: [...state.notes, note] }));
      send({ type: 'note.add', payload: { note } });
    },

    addClient: (input) => {
      const client: Client = {
        ...input,
        id: id('client'),
        notes: '',
        createdAt: nowIso(),
      };
      set((state) => ({ clients: [client, ...state.clients] }));
      send({ type: 'client.create', payload: { client } });
      return client;
    },

    updateClient: (clientId, patch) => {
      set((state) => ({
        clients: state.clients.map((client) =>
          client.id === clientId ? { ...client, ...patch } : client,
        ),
      }));
      send({ type: 'client.update', payload: { id: clientId, patch } });
    },

    convertLeadToClient: (leadId) => {
      const state = get();
      const lead = state.leads.find((item) => item.id === leadId);
      if (!lead) throw new Error('Lead not found');
      if (lead.clientId) return lead.clientId;

      const client: Client = {
        id: id('client'),
        name: lead.name,
        company: lead.company,
        email: lead.email,
        phone: lead.phone,
        city: lead.city,
        notes: '',
        createdAt: nowIso(),
      };
      set((current) => ({
        clients: [client, ...current.clients],
        leads: current.leads.map((item) =>
          item.id === leadId ? { ...item, clientId: client.id, status: 'accepted' } : item,
        ),
      }));
      send({ type: 'lead.convert', payload: { leadId, client } });
      return client.id;
    },

    createProposal: (seed = {}) => {
      const current = get();
      const lineItems = (seed.lineItems ?? [
        { id: id('line'), description: 'Production', quantity: 1, unitPriceMinor: 0 },
      ]).map((item) => ({ ...item, id: id('line') }));
      const proposal: Proposal = {
        id: id('proposal'),
        number: `SH-P-${1048 + current.proposals.length}`,
        title: 'Untitled proposal',
        status: 'draft',
        currency: 'INR',
        issuedAt: nowIso(),
        validUntil: format(addDays(new Date(), 14), 'yyyy-MM-dd') + 'T18:00:00',
        notes: '',
        updatedAt: nowIso(),
        ...seed,
        lineItems,
      };
      set((state) => ({ proposals: [proposal, ...state.proposals] }));
      send({ type: 'proposal.create', payload: { proposal } });
      return proposal;
    },

    updateProposal: (proposalId, patch) => {
      set((state) => ({
        proposals: state.proposals.map((proposal) =>
          proposal.id === proposalId
            ? { ...proposal, ...patch, id: proposal.id, updatedAt: nowIso() }
            : proposal,
        ),
      }));
      send({ type: 'proposal.update', payload: { id: proposalId, patch } });
    },

    setProposalStatus: (proposalId, status) => {
      const target = get().proposals.find((proposal) => proposal.id === proposalId);
      if (!target) return;
      const nextStatus: LeadStatus | undefined =
        status === 'accepted' ? 'accepted' : status === 'sent' ? 'proposal_sent' : undefined;
      set((state) => ({
        proposals: state.proposals.map((proposal) =>
          proposal.id === proposalId ? { ...proposal, status, updatedAt: nowIso() } : proposal,
        ),
        leads:
          target.leadId && nextStatus
            ? state.leads.map((lead) =>
                lead.id === target.leadId ? { ...lead, status: nextStatus } : lead,
              )
            : state.leads,
      }));
      send({ type: 'proposal.status', payload: { id: proposalId, status } });
    },

    createInvoice: (seed = {}) => {
      const current = get();
      const client = current.clients[0];
      const lineItems = (seed.lineItems ?? [
        { id: id('line'), description: 'Production', quantity: 1, unitPriceMinor: 0 },
      ]).map((item) => ({ ...item, id: id('line') }));
      const invoice: Invoice = {
        id: id('invoice'),
        number: `SH-${2057 + current.invoices.length}`,
        clientId: seed.clientId ?? client?.id ?? '',
        status: 'draft',
        currency: 'INR',
        issuedAt: nowIso(),
        dueAt: format(addDays(new Date(), 14), 'yyyy-MM-dd') + 'T18:00:00',
        notes: '',
        updatedAt: nowIso(),
        ...seed,
        lineItems,
      };
      set((state) => ({
        invoices: [invoice, ...state.invoices],
        leads: invoice.leadId
          ? state.leads.map((lead) =>
              lead.id === invoice.leadId ? { ...lead, status: 'payment_due' } : lead,
            )
          : state.leads,
      }));
      send({ type: 'invoice.create', payload: { invoice } });
      return invoice;
    },

    updateInvoice: (invoiceId, patch) => {
      set((state) => ({
        invoices: state.invoices.map((invoice) =>
          invoice.id === invoiceId
            ? { ...invoice, ...patch, id: invoice.id, updatedAt: nowIso() }
            : invoice,
        ),
      }));
      send({ type: 'invoice.update', payload: { id: invoiceId, patch } });
    },

    recordPayment: (input) => {
      const state = get();
      const invoice = state.invoices.find((item) => item.id === input.invoiceId);
      if (!invoice) return;
      const payment: Payment = {
        ...input,
        id: id('payment'),
        currency: invoice.currency,
      };
      const allPayments = [...state.payments, payment];
      const paid = allPayments
        .filter((item) => item.invoiceId === invoice.id)
        .reduce((total, item) => total + item.amountMinor, 0);
      const invoiceTotal = invoice.lineItems.reduce(
        (total, item) => total + item.quantity * item.unitPriceMinor,
        0,
      );
      const isPaid = paid >= invoiceTotal;
      set({
        payments: allPayments,
        invoices: state.invoices.map((item) =>
          item.id === invoice.id ? { ...item, status: 'sent', updatedAt: nowIso() } : item,
        ),
        leads: invoice.leadId
          ? state.leads.map((lead) =>
              lead.id === invoice.leadId
                ? { ...lead, status: isPaid ? 'paid' : 'payment_due' }
                : lead,
            )
          : state.leads,
      });
      send({ type: 'payment.record', payload: { payment } });
    },

    addEvent: (input) => {
      const event: CalendarEvent = { ...input, id: id('event') };
      set((state) => ({ events: [...state.events, event] }));
      send({ type: 'event.create', payload: { event } });
    },
  };
});
