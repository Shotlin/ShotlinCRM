import { z } from 'zod';

const currency = z.enum(['INR', 'USD', 'EUR', 'GBP']);
const leadStatus = z.enum(['new', 'connected', 'proposal_sent', 'accepted', 'payment_due', 'paid']);
const proposalStatus = z.enum(['draft', 'sent', 'accepted', 'declined', 'expired']);
const id = z.string().min(1).max(200);
const shortText = z.string().max(500);
const longText = z.string().max(20_000);
const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date');
const lineItem = z.object({
  id,
  description: z.string().min(1).max(500),
  quantity: z.number().int().min(1).max(10_000),
  unitPriceMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
const lineItems = z.array(lineItem).min(1).max(100);

const leadFields = {
  name: z.string().trim().min(1).max(200),
  company: shortText,
  phone: shortText,
  email: shortText,
  city: shortText,
  source: z.enum(['meta', 'whatsapp']),
  initialMessage: z.string().max(10_000),
  status: leadStatus,
  valueMinor: z.number().int().min(0),
  currency,
  ownerInitials: z.string().max(8),
  createdAt: isoDate,
  lastActivityAt: isoDate,
  followUpAt: isoDate.optional(),
  clientId: id.optional(),
  tags: z.array(z.string().max(50)).max(20),
};

const messageSchema = z.object({
  id,
  leadId: id,
  direction: z.enum(['inbound', 'outbound']),
  body: longText,
  sentAt: isoDate,
  source: z.enum(['meta', 'whatsapp']),
  state: z.enum(['sample', 'queued', 'sent', 'delivered', 'read', 'failed']),
});

const clientSchema = z.object({
  id,
  name: z.string().trim().min(1).max(200),
  company: shortText,
  email: shortText,
  phone: shortText,
  city: shortText,
  notes: longText,
  createdAt: isoDate,
});

const proposalSchema = z.object({
  id,
  number: z.string().min(1).max(50),
  leadId: id.optional(),
  clientId: id.optional(),
  title: z.string().min(1).max(300),
  status: proposalStatus,
  lineItems,
  currency,
  issuedAt: isoDate,
  validUntil: isoDate,
  notes: longText,
  updatedAt: isoDate,
});

const invoiceSchema = z.object({
  id,
  number: z.string().min(1).max(50),
  clientId: id,
  leadId: id.optional(),
  proposalId: id.optional(),
  status: z.enum(['draft', 'sent']),
  lineItems,
  currency,
  issuedAt: isoDate,
  dueAt: isoDate,
  notes: longText,
  updatedAt: isoDate,
});

const paymentSchema = z.object({
  id,
  invoiceId: id,
  amountMinor: z.number().int().positive(),
  currency,
  receivedAt: isoDate,
  method: z.enum(['bank', 'upi', 'card', 'cash', 'other']),
  note: longText,
});

const eventSchema = z.object({
  id,
  title: z.string().min(1).max(300),
  startsAt: isoDate,
  endsAt: isoDate,
  type: z.enum(['follow_up', 'meeting', 'proposal_expiry', 'payment_due']),
  leadId: id.optional(),
  clientId: id.optional(),
  href: z.string().max(500).optional(),
});

export const crmActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('lead.create'),
    payload: z.object({ lead: z.object({ id, ...leadFields }), message: messageSchema }),
  }),
  z.object({
    type: z.literal('lead.update'),
    payload: z.object({ id, patch: z.object(leadFields).partial().omit({ createdAt: true }).strict() }),
  }),
  z.object({ type: z.literal('lead.move'), payload: z.object({ id, status: leadStatus }) }),
  z.object({
    type: z.literal('lead.convert'),
    payload: z.object({ leadId: id, client: clientSchema }),
  }),
  z.object({ type: z.literal('reply.add'), payload: z.object({ message: messageSchema }) }),
  z.object({
    type: z.literal('note.add'),
    payload: z.object({ note: z.object({ id, leadId: id, body: z.string().min(1).max(10_000), createdAt: isoDate }) }),
  }),
  z.object({ type: z.literal('client.create'), payload: z.object({ client: clientSchema }) }),
  z.object({
    type: z.literal('client.update'),
    payload: z.object({
      id,
      patch: z
        .object({
          name: z.string().trim().min(1).max(200),
          company: shortText,
          email: shortText,
          phone: shortText,
          city: shortText,
          notes: longText,
        })
        .partial()
        .strict(),
    }),
  }),
  z.object({ type: z.literal('proposal.create'), payload: z.object({ proposal: proposalSchema }) }),
  z.object({
    type: z.literal('proposal.update'),
    payload: z.object({
      id,
      patch: proposalSchema
        .omit({ id: true })
        .partial()
        .strict(),
    }),
  }),
  z.object({ type: z.literal('proposal.status'), payload: z.object({ id, status: proposalStatus }) }),
  z.object({ type: z.literal('invoice.create'), payload: z.object({ invoice: invoiceSchema }) }),
  z.object({
    type: z.literal('invoice.update'),
    payload: z.object({
      id,
      patch: invoiceSchema.omit({ id: true }).partial().strict(),
    }),
  }),
  z.object({ type: z.literal('payment.record'), payload: z.object({ payment: paymentSchema }) }),
  z.object({ type: z.literal('event.create'), payload: z.object({ event: eventSchema }) }),
  z.object({
    type: z.literal('settings.reportingCurrency'),
    payload: z.object({ currency }),
  }),
]);

export type ValidatedCrmAction = z.infer<typeof crmActionSchema>;
