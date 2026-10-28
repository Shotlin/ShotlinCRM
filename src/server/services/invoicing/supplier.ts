// Supplier details printed on every invoice. Values come from the existing templates.

export const SUPPLIER = {
  name: 'Shotlin Digital Product Studio',
  brand: 'SHOTLIN',
  addressLines: [
    'Floor No.: Ground Floor, Old. No.: 39374, Holding No. 379/N Banipur Palpara Ward 13,',
    'S.N. Dey Road, Habra, Dist: North Twenty Four Parganas, West Bengal - 743233',
  ],
  phone: '+917074502635',
  email: 'shotlin085@gmail.com',
  website: 'shotlin.com',
  gstin: '19HATPM4170H1Z1',
  state: 'West Bengal',
  stateCode: '19',
  issueCity: 'Kolkata, West Bengal',
  footerLine: 'Shotlin | Habra, West Bengal, India | shotlin085@gmail.com | shotlin.com',
} as const;

// The signatory spelling differs between the templates ("Mandal") and the agreements
// ("Mondal"), so it is configuration, not code. Set INVOICE_SIGNATORY once it is confirmed.
export const signatoryName = () => process.env.INVOICE_SIGNATORY ?? 'Sayan Mandal';

// The signature image is private, so it lives outside the repository.
export const signaturePath = () =>
  process.env.INVOICE_SIGNATURE_PATH ?? '/opt/shotlin-crm/data/assets/signature.png';

export const STANDARD_CATEGORY = 'Software / Digital Product Development';
export const REVERSE_CHARGE_TEXT = 'No (RCM Not Applicable)';
export const DEFAULT_JURISDICTION_TERM =
  'Jurisdiction: Kolkata, West Bengal, India. Disputes, if any, shall be handled under applicable Indian law and agreed commercial terms.';
