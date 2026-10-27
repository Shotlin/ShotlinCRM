import { describe, expect, it } from 'vitest';
import { extractTemplateVariables, renderTemplate, validateTemplate } from './render';

describe('message templates', () => {
  it('renders supported lead variables', () => {
    expect(
      renderTemplate('Hi {{name}}, a note for {{ company }}.', {
        name: 'Riya',
        company: 'Riya Films',
      }),
    ).toBe('Hi Riya, a note for Riya Films.');
  });

  it('rejects unknown variables instead of silently sending placeholders', () => {
    expect(() => validateTemplate('Hello {{first_name}}')).toThrow(/Unknown template variables/);
  });

  it('extracts variables for editor validation', () => {
    expect(extractTemplateVariables('{{name}} {{followUpDate}} {{name}}')).toEqual([
      'name',
      'followUpDate',
      'name',
    ]);
  });

  it('uses an empty string for a missing lead value', () => {
    expect(renderTemplate('Follow up {{followUpDate}}', {})).toBe('Follow up ');
  });
});
