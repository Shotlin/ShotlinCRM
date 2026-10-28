export type Currency = 'INR' | 'USD' | 'EUR' | 'GBP';

export type LeadStatus =
  | 'new'
  | 'connected'
  | 'proposal_sent'
  | 'accepted'
  | 'payment_due'
  | 'paid';

export type LeadSource = 'meta' | 'whatsapp';

export type ProposalStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';

export type InvoiceStatus = 'draft' | 'sent';

export type PaymentMethod = 'bank' | 'upi' | 'card' | 'cash' | 'other';

export type LineItem = {
  id: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
};

export type Lead = {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  city: string;
  source: LeadSource;
  initialMessage: string;
  status: LeadStatus;
  valueMinor: number;
  currency: Currency;
  ownerInitials: string;
  createdAt: string;
  lastActivityAt: string;
  followUpAt?: string;
  clientId?: string;
  tags: string[];
  // Unread WhatsApp messages in this chat.
  unread?: number;
};

export type Message = {
  id: string;
  leadId: string;
  direction: 'inbound' | 'outbound';
  body: string;
  sentAt: string;
  source: LeadSource;
  state: 'sample' | 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
  kind?: 'text' | 'image' | 'video' | 'audio' | 'document';
  media?: {
    id: string;
    mimeType: string;
    filename?: string;
    url: string;
  };
};

export type Client = {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  city: string;
  notes: string;
  createdAt: string;
};

export type Proposal = {
  id: string;
  number: string;
  leadId?: string;
  clientId?: string;
  title: string;
  status: ProposalStatus;
  lineItems: LineItem[];
  currency: Currency;
  issuedAt: string;
  validUntil: string;
  notes: string;
  updatedAt: string;
};

export type Invoice = {
  id: string;
  number: string;
  clientId: string;
  leadId?: string;
  proposalId?: string;
  status: InvoiceStatus;
  lineItems: LineItem[];
  currency: Currency;
  issuedAt: string;
  dueAt: string;
  notes: string;
  updatedAt: string;
};

export type Payment = {
  id: string;
  invoiceId: string;
  amountMinor: number;
  currency: Currency;
  receivedAt: string;
  method: PaymentMethod;
  note: string;
};

export type LeadNote = {
  id: string;
  leadId: string;
  body: string;
  createdAt: string;
};

export type CalendarEventType = 'follow_up' | 'meeting' | 'proposal_expiry' | 'payment_due';

export type CalendarEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  type: CalendarEventType;
  leadId?: string;
  clientId?: string;
  href?: string;
};

export type CrmData = {
  leads: Lead[];
  // WhatsApp chats that are not in the pipeline (same shape as a lead).
  chats: Lead[];
  messages: Message[];
  clients: Client[];
  proposals: Proposal[];
  invoices: Invoice[];
  payments: Payment[];
  notes: LeadNote[];
  events: CalendarEvent[];
};

export type CurrencyRates = Record<Currency, number>;
