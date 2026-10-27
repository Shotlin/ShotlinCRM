import type { MetaLeadPayload } from './graph';

const initialKeys = ['message', 'enquiry', 'enquiry_message', 'whatsapp_message', 'notes'];

export function mapMetaLeadFields(payload: MetaLeadPayload, attributionLabel?: string) {
  const fields: Record<string, string[]> = {};
  for (const field of payload.field_data ?? []) fields[field.name] = field.values;
  const first = (...keys: string[]) => keys.map((key) => fields[key]?.[0]).find(Boolean) ?? '';
  const fullName =
    first('full_name', 'full name', 'name') ||
    [first('first_name', 'first name'), first('last_name', 'last name')].filter(Boolean).join(' ');
  const customMessage = initialKeys.map((key) => first(key)).find(Boolean);
  const summary = Object.entries(fields)
    .flatMap(([name, values]) => values.map((value) => `${name}: ${value}`))
    .join('\n');

  return {
    name: fullName || 'Meta lead',
    company: first('company_name', 'company', 'business_name'),
    phone: first('phone_number', 'phone', 'mobile_number'),
    email: first('email', 'email_address'),
    city: first('city', 'location'),
    initialMessage:
      customMessage ||
      `Meta Lead Ads enquiry${attributionLabel ? ` · ${attributionLabel}` : ''}${summary ? `\n\n${summary}` : ''}`,
    fields,
  };
}
