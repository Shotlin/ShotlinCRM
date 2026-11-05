import { z } from 'zod';

// These fields are the only prospect information a future research run may
// receive. Conversation history and financial records are intentionally absent.
// URL syntax validation is not a substitute for DNS/IP and redirect checks at
// the network boundary; never fetch these URLs without a hardened fetcher.
const optionalText = (max: number) => z.string().trim().max(max).default('');
const publicWebUrl = z.union([
  z.literal(''),
  z.string().trim().max(2048).url().superRefine((value, ctx) => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      ctx.addIssue({ code: 'custom', message: 'Use an HTTP or HTTPS URL without credentials' });
    }
  }),
]).default('');

export const websiteProspectSchema = z.object({
  leadId: z.string().trim().min(1).max(200).optional(),
  businessName: z.string().trim().min(1).max(200),
  industry: optionalText(200),
  city: optionalText(200),
  country: optionalText(200),
  mapsUrl: publicWebUrl,
  instagramUrl: publicWebUrl,
  websiteUrl: publicWebUrl,
  description: optionalText(4000),
  requirements: optionalText(8000),
  designPreferences: optionalText(4000),
  instructions: optionalText(4000),
}).strict();

export type WebsiteProspect = z.infer<typeof websiteProspectSchema>;
