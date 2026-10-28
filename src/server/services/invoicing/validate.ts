import { z } from 'zod';
import { deriveSupplyType } from './calc';

export { deriveSupplyType };

// Format checks only: a well-formed GSTIN is not proof of registration.
export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_PATTERN = /^[A-Z]{5}\d{4}[A-Z]$/;

const text = (max: number) => z.string().trim().max(max);

export const gstInvoiceInputSchema = z
  .object({
    clientId: z.string().min(1),
    leadId: z.string().min(1).optional(),
    docType: z.enum(['final', 'advance', 'regular']),
    issuedAt: z.coerce.date(),
    dueAt: z.coerce.date().optional(),
    taxRatePct: z.number().int().min(0).max(28).default(18),
    sac: z.string().regex(/^\d{4,8}$/, 'SAC must be 4 to 8 digits').default('998314'),
    paymentTerms: text(200).optional(),
    customer: z.object({
      name: text(200).min(1, 'Customer name is required'),
      representative: text(200).optional(),
      address: text(400).min(1, 'Billing address is required'),
      cityStatePin: text(200).min(1, 'City / state / PIN is required'),
      pan: z.string().trim().toUpperCase().optional(),
      gstin: z.string().trim().toUpperCase().optional(),
      placeOfSupply: text(100).min(1, 'Place of supply is required'),
      stateCode: z.string().regex(/^\d{2}$/, 'State code must be two digits'),
    }),
    project: z.object({
      name: text(300).min(1, 'Project / service name is required'),
      category: text(200).optional(),
      reference: text(300).optional(),
      advanceRef: text(200).optional(),
      advanceNote: text(300).optional(),
    }),
    lines: z
      .array(
        z.object({
          description: text(300).min(1),
          detail: text(2000).optional(),
          qty: z.number().int().min(1).max(100_000),
          // Unit price in paise, before tax.
          unitPriceMinor: z.number().int().min(1),
        }),
      )
      .min(1)
      .max(20),
    projectTaxableMinor: z.number().int().positive().optional(),
    advanceTaxableMinor: z.number().int().min(0).optional(),
    gstTreatment: text(1000).optional(),
    adjustmentNote: text(2000).optional(),
    terms: z.array(text(1000).min(1)).max(12).optional(),
  })
  .superRefine((input, ctx) => {
    const fail = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    const { customer } = input;

    if (customer.gstin) {
      if (!GSTIN_PATTERN.test(customer.gstin)) fail(['customer', 'gstin'], 'GSTIN format is not valid');
      else if (customer.gstin.slice(0, 2) !== customer.stateCode) {
        fail(['customer', 'gstin'], 'The GSTIN starts with a different state code than the place of supply');
      }
    }
    if (customer.pan) {
      if (!PAN_PATTERN.test(customer.pan)) fail(['customer', 'pan'], 'PAN format is not valid');
      else if (customer.gstin && GSTIN_PATTERN.test(customer.gstin) && customer.gstin.slice(2, 12) !== customer.pan) {
        fail(['customer', 'pan'], 'The PAN does not match the PAN inside the GSTIN');
      }
    }

    const billable = input.lines.reduce((sum, line) => sum + line.qty * line.unitPriceMinor, 0);
    const advance = input.advanceTaxableMinor ?? 0;
    const project = input.projectTaxableMinor;
    if (input.docType === 'final' && project !== undefined) {
      if (advance > project) fail(['advanceTaxableMinor'], 'The advance cannot be more than the total project value');
      else if (billable !== project - advance) {
        fail(['lines'], 'Line items must add up to the balance: total project value minus the advance');
      }
    }
    if (input.docType === 'advance') {
      if (project !== undefined && advance > project) {
        fail(['advanceTaxableMinor'], 'The advance cannot be more than the total project value');
      }
      if (input.advanceTaxableMinor !== undefined && billable !== advance) {
        fail(['lines'], 'Line items must add up to the advance amount');
      }
    }
  });

export type GstInvoiceInput = z.infer<typeof gstInvoiceInputSchema>;

export const cancelInputSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) });
