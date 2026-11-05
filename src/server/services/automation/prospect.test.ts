import { describe, expect, it } from 'vitest';
import { websiteProspectSchema } from './prospect';

describe('website automation prospect input', () => {
  it('accepts a prospect with only the fields needed for research', () => {
    const result = websiteProspectSchema.parse({ businessName: 'Example Studio', city: 'Kolkata' });
    expect(result).toMatchObject({ businessName: 'Example Studio', city: 'Kolkata', mapsUrl: '' });
  });

  it('rejects unexpected private CRM context', () => {
    expect(websiteProspectSchema.safeParse({ businessName: 'Example', messages: ['private'] }).success).toBe(false);
  });

  it.each(['file:///etc/passwd', 'https://user:password@example.com', 'javascript:alert(1)'])(
    'rejects unsafe URL syntax: %s',
    (websiteUrl) => expect(websiteProspectSchema.safeParse({ businessName: 'Example', websiteUrl }).success).toBe(false),
  );
});
