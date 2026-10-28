// Shared by the server and the expenses page, so it must not import anything server-only.
export const EXPENSE_CATEGORIES = [
  { id: 'salary', label: 'Salary & wages', color: '#756086' },
  { id: 'software', label: 'Software & AI tools', color: '#4d7f7a' },
  { id: 'ads', label: 'Ads & marketing', color: '#aa514a' },
  { id: 'hosting', label: 'Hosting, cloud & APIs', color: '#526f93' },
  { id: 'internet', label: 'Internet & phone', color: '#5a8aa3' },
  { id: 'electricity', label: 'Electricity', color: '#a37a1f' },
  { id: 'water', label: 'Water', color: '#5f8fb5' },
  { id: 'rent', label: 'Rent & office', color: '#8a6a4a' },
  { id: 'loan', label: 'Loan / EMI', color: '#94587a' },
  { id: 'bank', label: 'Bank & card charges', color: '#7b7f78' },
  { id: 'tax', label: 'Taxes & government', color: '#3f7551' },
  { id: 'equipment', label: 'Equipment & hardware', color: '#7a6a9a' },
  { id: 'professional', label: 'Professional fees', color: '#b0693f' },
  { id: 'travel', label: 'Travel & transport', color: '#4a8f85' },
  { id: 'emergency', label: 'Emergency / one-off', color: '#aa514a' },
  { id: 'other', label: 'Other', color: '#7b7f78' },
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
