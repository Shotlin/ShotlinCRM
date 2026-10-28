// Shared by the server and the expenses page, so it must not import anything server-only.
export const EXPENSE_CATEGORIES = [
  { id: 'salary', label: 'Salary & wages', color: '#6d4aff' },
  { id: 'software', label: 'Software & AI tools', color: '#0e8f8a' },
  { id: 'ads', label: 'Ads & marketing', color: '#e5484d' },
  { id: 'hosting', label: 'Hosting, cloud & APIs', color: '#2f6fed' },
  { id: 'internet', label: 'Internet & phone', color: '#0b9ed1' },
  { id: 'electricity', label: 'Electricity', color: '#e8a100' },
  { id: 'water', label: 'Water', color: '#2a9df4' },
  { id: 'rent', label: 'Rent & office', color: '#9a6b3f' },
  { id: 'loan', label: 'Loan / EMI', color: '#b4337a' },
  { id: 'bank', label: 'Bank & card charges', color: '#5b6b7d' },
  { id: 'tax', label: 'Taxes & government', color: '#2e7d4f' },
  { id: 'equipment', label: 'Equipment & hardware', color: '#7a5af8' },
  { id: 'professional', label: 'Professional fees', color: '#d9622b' },
  { id: 'travel', label: 'Travel & transport', color: '#12a594' },
  { id: 'emergency', label: 'Emergency / one-off', color: '#d92d20' },
  { id: 'other', label: 'Other', color: '#6b7280' },
] as const;

export const PAYEE_TYPES = [
  { id: 'person', label: 'Person' },
  { id: 'vendor', label: 'Company / vendor' },
  { id: 'platform', label: 'Platform / app' },
  { id: 'bank', label: 'Bank' },
  { id: 'loan', label: 'Loan provider' },
  { id: 'utility', label: 'Utility' },
  { id: 'government', label: 'Government' },
  { id: 'other', label: 'Other' },
] as const;

export type CategoryId = (typeof EXPENSE_CATEGORIES)[number]['id'];
export type PayeeTypeId = (typeof PAYEE_TYPES)[number]['id'];
export const categoryOf = (id: string) => EXPENSE_CATEGORIES.find((c) => c.id === id) ?? EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
