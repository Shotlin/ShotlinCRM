import { mapMetaLeadFields } from './fields';
import type { MetaLeadPayload } from './graph';
import { describe, expect, it } from 'vitest';

const payload: MetaLeadPayload = {
  id: 'leadgen-123',
  created_time: '2026-10-27T09:00:00+0000',
  form_id: 'form-1',
  field_data: [
    { name: 'full_name', values: ['Meera Kapoor'] },
    { name: 'company_name', values: ['Kapoor Studio'] },
    { name: 'phone_number', values: ['+91 98765 11111'] },
    { name: 'email', values: ['meera@example.com'] },
    { name: 'message', values: ['We need a launch film in January.'] },
  ],
};

describe('Meta lead field mapping', () => {
  it('preserves contact details and the original enquiry', () => {
    const mapped = mapMetaLeadFields(payload, 'Launch film ad');
    expect(mapped.name).toBe('Meera Kapoor');
    expect(mapped.company).toBe('Kapoor Studio');
    expect(mapped.email).toBe('meera@example.com');
    expect(mapped.initialMessage).toBe('We need a launch film in January.');
  });

  it('creates a readable lead when the form has no free-text question', () => {
    const mapped = mapMetaLeadFields({ ...payload, field_data: payload.field_data?.slice(0, 4) }, 'Spring ad');
    expect(mapped.initialMessage).toContain('Meta Lead Ads enquiry');
    expect(mapped.initialMessage).toContain('Spring ad');
    expect(mapped.name).toBe('Meera Kapoor');
  });
});
