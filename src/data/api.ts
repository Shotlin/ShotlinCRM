import type {
  CalendarEvent,
  Client,
  Currency,
  Invoice,
  Lead,
  LeadNote,
  LeadStatus,
  Message,
  Payment,
  Proposal,
  ProposalStatus,
} from './types';

export type CrmAction =
  | { type: 'lead.create'; payload: { lead: Lead; message: Message } }
  | { type: 'lead.update'; payload: { id: string; patch: Partial<Lead> } }
  | { type: 'lead.move'; payload: { id: string; status: LeadStatus } }
  | { type: 'lead.convert'; payload: { leadId: string; client: Client } }
  | { type: 'reply.add'; payload: { message: Message } }
  | { type: 'note.add'; payload: { note: LeadNote } }
  | { type: 'client.create'; payload: { client: Client } }
  | { type: 'client.update'; payload: { id: string; patch: Partial<Client> } }
  | { type: 'proposal.create'; payload: { proposal: Proposal } }
  | { type: 'proposal.update'; payload: { id: string; patch: Partial<Proposal> } }
  | { type: 'proposal.status'; payload: { id: string; status: ProposalStatus } }
  | { type: 'invoice.create'; payload: { invoice: Invoice } }
  | { type: 'invoice.update'; payload: { id: string; patch: Partial<Invoice> } }
  | { type: 'payment.record'; payload: { payment: Payment } }
  | { type: 'event.create'; payload: { event: CalendarEvent } }
  | { type: 'settings.reportingCurrency'; payload: { currency: Currency } };

export type CrmActionType = CrmAction['type'];
