import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env.local');
} catch {
  // Deployment environments provide variables directly.
}

// Brings the FY 2026-27 register (clients, invoices, payments and the issued PDFs) into the CRM.
// Figures come from the data room's GST_Series / GST_Pending / Pay_Ledger sheets and the PDFs themselves.
//   --dry-run   checks every document and its total against the register, writes nothing
//   --pdfs DIR  folder holding ADV-101.pdf, INV-101.pdf ... (stored in R2 compressed, as the master copy)
const dryRun = process.argv.includes('--dry-run');
const pdfDir = process.argv.includes('--pdfs') ? process.argv[process.argv.indexOf('--pdfs') + 1] : null;

const { db, pool } = await import('../src/server/db/client');
const { clients, payments, workspaces } = await import('../src/server/db/schema');
const { gstInvoiceInputSchema } = await import('../src/server/services/invoicing/validate');
const { computeTotals } = await import('../src/server/services/invoicing/calc');
const { importLegacyGstInvoice, invoiceFileName, loadGstInvoice } = await import('../src/server/services/invoicing/issue');
const { frozenKey } = await import('../src/server/services/invoicing/frozen');
const { optimizePdf } = await import('../src/server/storage/compress');
const { headObjectInBucket, putObjectToBucket, resolveStorage } = await import('../src/server/storage');

type Cust = {
  key: string;
  name: string;
  company: string;
  kind: 'B2B' | 'B2C';
  phone?: string;
  city: string;
  notes: string;
  bill: {
    name: string;
    representative?: string;
    address: string;
    cityStatePin: string;
    pan?: string;
    gstin?: string;
    placeOfSupply: string;
    stateCode: string;
  };
};

const bakalooOld = 'Bhagat Food Zone, Nr Anand Dhara Soc - 2, Ram Chowk, Mota Varachha';
const bakalooNew = 'Shop No. 27, Khari Faliyu, Ananddhara V-2 Road, Opp. Rudraksh Residency, Ramchowk, Mota Varachha';

const customers: Record<string, Cust> = {
  radha: {
    key: 'radha',
    name: 'Padmashali Vanajakshi',
    company: 'Individual',
    kind: 'B2C',
    city: 'Ahmedabad',
    notes: 'B2C · unregistered · Project RADHA',
    bill: {
      name: 'Padmashali Vanajakshi',
      address:
        'S/O Hanumanthbhai, 7/147, Vasantrajab Nagar, Vasantrajabnagar Parsottam Kumbharni Chali, Sant Rohidas Lati, Behrampura, Ahmedabad City, Ahmedabad',
      cityStatePin: 'Ahmedabad, Gujarat - 380022',
      placeOfSupply: 'Gujarat (24)',
      stateCode: '24',
    },
  },
  bakaloo: {
    key: 'bakaloo',
    name: 'Bakaloo and Food Enterprise',
    company: 'Proprietorship',
    kind: 'B2B',
    city: 'Surat',
    notes: 'B2B · GSTIN 24ABFFB1171P1ZD · PAN ABFFB1171P · Contact: Nikhil Patel, Owner',
    bill: {
      name: 'Bakaloo and Food Enterprise',
      address: bakalooOld,
      cityStatePin: 'Surat, Gujarat - 394101',
      pan: 'ABFFB1171P',
      gstin: '24ABFFB1171P1ZD',
      placeOfSupply: 'Gujarat (24)',
      stateCode: '24',
    },
  },
  lndry: {
    key: 'lndry',
    name: 'LNDRY Care Technology Pvt. Ltd.',
    company: 'Private Limited',
    kind: 'B2B',
    city: 'Pune',
    notes: 'B2B · Private Limited · GST unregistered · Contact: Anmol Kumar, Founder & CEO',
    bill: {
      name: 'LNDRY Care Technology Pvt. Ltd.',
      representative: 'Anmol Kumar, Founder & CEO',
      address: '301, Floor 3/Shaft 1, Tower H, Bramha Sky City, Dhanori',
      cityStatePin: 'Pune, Maharashtra - 411015',
      placeOfSupply: 'Maharashtra (27)',
      stateCode: '27',
    },
  },
  jimmy: {
    key: 'jimmy',
    name: 'JIMMY AND WAX (G.HRITHIK)',
    company: 'Proprietorship',
    kind: 'B2B',
    phone: '9398888101',
    city: 'Hyderabad',
    notes: 'B2B · GSTIN 36CROPG2620M3ZI · PAN CROPG2620M · Mobiles: 9398888101 / 9849595164',
    bill: {
      name: 'JIMMY AND WAX (G.HRITHIK)',
      address: 'Plot No. 3-1/56, NEKNAMPURE, PRASANTHI NAGAR',
      cityStatePin: 'Hyderabad, Telangana - 500089',
      pan: 'CROPG2620M',
      gstin: '36CROPG2620M3ZI',
      placeOfSupply: 'Telangana (36)',
      stateCode: '36',
    },
  },
  empire: {
    key: 'empire',
    name: 'THE EMPIRE STORE',
    company: 'Proprietorship',
    kind: 'B2B',
    city: 'New Delhi',
    notes: 'B2B · GSTIN 07CJJPR6863G1ZN · Contact: Dishant Rajora, Proprietor',
    bill: {
      name: 'THE EMPIRE STORE (Proprietorship)',
      representative: 'Dishant Rajora, Proprietor',
      address: 'Block 11, 22, Patel Nagar marg, Patel Nagar East',
      cityStatePin: 'New Delhi, North West Delhi, Delhi - 110008',
      gstin: '07CJJPR6863G1ZN',
      placeOfSupply: 'Delhi (07)',
      stateCode: '07',
    },
  },
  dealkr: {
    key: 'dealkr',
    name: 'M/s DM Mobile Shop (DEALKR)',
    company: 'Proprietorship',
    kind: 'B2B',
    city: 'New Delhi',
    notes: 'B2B · Brand DEALKR · GSTIN 07DOAPD4998K1ZI · PAN DOAPD4998K · Contact: Deepak Paswan, Proprietor',
    bill: {
      name: 'M/s DM Mobile Shop (Brand: DEALKR)',
      representative: 'Deepak Paswan, Proprietor',
      address: 'Jaipur Golden Heart Hospital, Ground Floor, Flat No. 289, Shop No. 2, Pocket 6 II, Sector-2, Rohini',
      cityStatePin: 'New Delhi, Delhi - 110085',
      pan: 'DOAPD4998K',
      gstin: '07DOAPD4998K1ZI',
      placeOfSupply: 'Delhi (07)',
      stateCode: '07',
    },
  },
};

const rupees = (value: number) => Math.round(value * 100);
const at = (date: string) => new Date(`${date}T00:00:00+05:30`);

type Doc = {
  file: string | null;
  docNo: string;
  serial: number;
  docType: 'final' | 'advance' | 'regular';
  date: string;
  who: keyof typeof customers;
  address?: string;
  representative?: string;
  project: { name: string; category?: string; reference?: string; advanceRef?: string };
  lines: { description: string; detail?: string; rupees: number }[];
  projectTaxable?: number;
  advanceTaxable?: number;
  paymentTerms: string;
  adjustmentNote?: string;
  status: 'draft' | 'sent' | 'paid';
  grossRupees: number;
  payment?: { date: string; method: string; note?: string };
};

const docs: Doc[] = [
  {
    file: 'INV-101', docNo: 'SL/INV/26-27/101', serial: 101, docType: 'final', date: '2026-05-13', who: 'radha',
    project: { name: 'RADHA', category: 'Software / Digital Product Development', reference: 'Approved RADHA project scope' },
    lines: [
      { description: 'Mobile Application (Flutter - Android & iOS)', detail: 'Barcode/EAN scanning, expiry tracking, role access, tasks, scan history, bulk scan and reports.', rupees: 15000 },
      { description: 'Admin Panel (React.js / Next.js)', detail: 'User management, EAN upload, product data, analytics, task overview, scan history and reports.', rupees: 5000 },
      { description: 'Backend & Database (Node.js / Laravel)', detail: 'API setup, authentication, core logic, scan and task records, reporting and integration support.', rupees: 5500 },
      { description: 'Marketing Website (Next.js)', detail: 'App overview, feature showcase, login redirect, contact section and agreed domain setup.', rupees: 3000 },
      { description: 'UI/UX Design (Mobile + Web)', detail: 'Wireframes, design system and screens for mobile app, admin panel and website.', rupees: 1499 },
    ],
    paymentTerms: 'Paid in full upfront (EMI via Bank / Provider)', status: 'paid', grossRupees: 35399,
    payment: { date: '2026-05-13', method: 'EMI via Bank / Provider' },
  },
  {
    file: 'ADV-101', docNo: 'SL/ADV/26-27/101', serial: 101, docType: 'advance', date: '2026-05-19', who: 'bakaloo',
    project: { name: 'Project Bakaloo Customer App + Rider App + Website + Admin Dashboard + Backend', reference: 'Project Bakaloo Agreement dated 19 May 2026' },
    lines: [{ description: 'Project Bakaloo - Payment / Project Kickoff Milestone Advance', detail: 'Advance received against the approved software development scope, including customer app, rider app, admin dashboard, backend API, marketing website and UI/UX design. This advance is adjustable against the final/balance invoice.', rupees: 15000 }],
    projectTaxable: 29999, advanceTaxable: 15000, paymentTerms: 'Advance received for project kickoff', status: 'paid', grossRupees: 17700,
    payment: { date: '2026-05-19', method: 'Not stated' },
  },
  {
    file: 'ADV-102', docNo: 'SL/ADV/26-27/102', serial: 102, docType: 'advance', date: '2026-06-15', who: 'lndry',
    project: { name: 'LNDRY Phase 1 Marketplace MVP', category: 'Software / Digital Product Development', reference: 'Agreement Version 3.0 dated 15 June 2026' },
    lines: [{ description: 'LNDRY Phase 1 Marketplace MVP - Milestone 1 Advance Payment', detail: 'Advance received for the first project milestone under Agreement Version 3.0. Milestone 1 releases project initiation, requirement lock, wireframes and architecture setup.', rupees: 11000 }],
    projectTaxable: 50000, advanceTaxable: 11000, paymentTerms: 'Milestone 1 advance received', status: 'paid', grossRupees: 12980,
    payment: { date: '2026-06-15', method: 'Not stated' },
  },
  {
    file: 'INV-102', docNo: 'SL/INV/26-27/102', serial: 102, docType: 'final', date: '2026-07-06', who: 'bakaloo',
    project: { name: 'Project Bakaloo Customer App + Website + Admin Dashboard + Backend', reference: 'Project Bakaloo Agreement dated 19 May 2026', advanceRef: 'SL/ADV/26-27/101 dated 19 May 2026' },
    lines: [{ description: 'Project Bakaloo - Final Payment / Balance Delivery Milestone', detail: 'Final balance against the approved software development scope after adjusting the advance invoice, including delivery, deployment support and handover assistance.', rupees: 14999 }],
    projectTaxable: 29999, advanceTaxable: 15000, paymentTerms: 'Due before final delivery / handover', status: 'sent', grossRupees: 17699,
  },
  {
    file: 'INV-103', docNo: 'SL/INV/26-27/103', serial: 103, docType: 'regular', date: '2026-07-06', who: 'bakaloo',
    project: { name: 'Project Bakaloo Customer App + Website + Admin Dashboard + Backend', reference: 'Project Bakaloo Data Server Migration & Setup' },
    lines: [{ description: 'Project Bakaloo - Data Server Migration & Setup', detail: 'Data/server migration planning, server configuration, transfer support, deployment assistance, basic verification and stability checking for Project Bakaloo.', rupees: 5000 }],
    paymentTerms: 'Due on receipt / before migration completion',
    adjustmentNote: 'Opslin subscription for three months is included in the migration package at no separate charge and is not billed as a separate taxable line item.',
    status: 'sent', grossRupees: 5900,
  },
  {
    file: 'INV-104', docNo: 'SL/INV/26-27/104', serial: 104, docType: 'regular', date: '2026-07-06', who: 'bakaloo',
    project: { name: 'Project Bakaloo Customer App + Website + Admin Dashboard + Backend', reference: 'Project Bakaloo Add-on / Change Request' },
    lines: [{ description: 'Project Bakaloo - Function Add-on Development', detail: 'Additional function development, implementation, integration assistance, testing and deployment support as a billable change request outside the original base scope.', rupees: 20000 }],
    paymentTerms: 'Due on receipt / before add-on deployment', status: 'sent', grossRupees: 23600,
  },
  {
    file: 'ADV-103', docNo: 'SL/ADV/26-27/103', serial: 103, docType: 'advance', date: '2026-09-08', who: 'jimmy',
    project: { name: 'Shoe Polish Digital Platform', category: 'Website, Mobile App & Admin Dashboard Development', reference: 'Proposal dated 30 June 2026' },
    lines: [{ description: 'Website + Mobile App + Admin Dashboard Development - 50% Advance Payment', detail: '50% development advance against the agreed one-time taxable development value of Rs. 29,000.00, as per proposal dated 30 June 2026.', rupees: 14500 }],
    projectTaxable: 29000, advanceTaxable: 14500, paymentTerms: '50% advance received at project confirmation', status: 'paid', grossRupees: 17110,
    payment: { date: '2026-09-08', method: 'Not stated', note: 'Bank / UTR reference not provided in the register.' },
  },
  {
    file: 'ADV-104', docNo: 'SL/ADV/26-27/104', serial: 104, docType: 'advance', date: '2026-09-09', who: 'bakaloo', address: bakalooNew, representative: 'Nikhil Patel, Owner & Authorised Signatory',
    project: { name: 'Bakaloo B2B Expansion + CRM, WhatsApp & POS Upgrade', category: 'Software / Digital Product Upgrade', reference: 'Proposal dated 04 September 2026 + accepted Milestone 1 scope' },
    lines: [{ description: 'Project Bakaloo Upgrade - Milestone 1 Advance Payment', detail: 'Milestone 1 advance for B2B/B2C experience layout plus homepage lucky-winner / jackpot spin wheel (single spin with 5-6 reward/prize items), under the accepted upgrade scope.', rupees: 20000 }],
    projectTaxable: 50000, advanceTaxable: 20000, paymentTerms: 'Milestone 1 advance received on 09 September 2026', status: 'paid', grossRupees: 23600,
    payment: { date: '2026-09-09', method: 'Not stated', note: 'Bank / UTR reference not provided in the register.' },
  },
  {
    file: null, docNo: 'SL/ADV/26-27/105', serial: 105, docType: 'advance', date: '2026-09-29', who: 'empire',
    project: { name: 'The Empire Store Multi-Store Grocery Quick-Commerce Platform', category: 'Software / Quick-Commerce Platform Development', reference: 'Project Development Agreement Version 1.5 dated 16 September 2026' },
    lines: [{ description: 'The Empire Store - Milestone 1 Advance / Kickoff (B2B)', detail: '20% kickoff advance covering requirement lock, architecture, UI/UX setup, multi-store foundation and first-stage development under the accepted Version 1.5 agreement.', rupees: 9000 }],
    projectTaxable: 45000, advanceTaxable: 9000, paymentTerms: 'Milestone 1 advance / kickoff due before work starts', status: 'draft', grossRupees: 10620,
  },
  {
    file: null, docNo: 'SL/ADV/26-27/106', serial: 106, docType: 'advance', date: '2026-10-01', who: 'bakaloo', address: bakalooNew, representative: 'Nikhil Patel, Owner & Authorised Signatory',
    project: { name: 'Bakaloo B2B Expansion + CRM, WhatsApp & POS Upgrade', category: 'Software / Digital Product Upgrade', reference: 'Accepted proposal dated 04 September 2026 + Milestone 2 commercial split' },
    lines: [{ description: 'Project Bakaloo Upgrade - Milestone 2 Advance Payment', detail: 'Advance against CRM + WhatsApp integration + POS system: customer CRM and activity view, WhatsApp Business API based operational messaging, and counter/POS billing connected to the existing Bakaloo backend/database.', rupees: 20000 }],
    projectTaxable: 50000, advanceTaxable: 20000, paymentTerms: 'Milestone 2 advance due before CRM + WhatsApp + POS implementation', status: 'sent', grossRupees: 23600,
  },
  {
    file: 'ADV-107', docNo: 'SL/ADV/26-27/107', serial: 107, docType: 'advance', date: '2026-10-03', who: 'dealkr',
    project: { name: 'DEALKR Multi-Vendor E-Commerce Marketplace', category: 'B2B Multi-Vendor E-Commerce Platform Development', reference: 'Agreement dated 03 October 2026 | UID: SL-ADV-26-27-107-DEALKR-M1' },
    lines: [{ description: 'DEALKR - Milestone 1 Kickoff Advance Payment', detail: 'Initial kickoff advance for Customer App, Vendor App, Admin Operations Dashboard, E-Commerce Website and shared backend/API/database under the agreed multi-vendor marketplace scope.', rupees: 20000 }],
    projectTaxable: 60000, advanceTaxable: 20000, paymentTerms: 'Milestone 1 / initial advance due before project start', status: 'sent', grossRupees: 23600,
  },
];

// ---- check every document before anything is written
let problems = 0;
const built = docs.map((doc) => {
  const customer = customers[doc.who];
  const parsed = gstInvoiceInputSchema.safeParse({
    clientId: `client-legacy-${customer.key}`,
    docType: doc.docType,
    issuedAt: at(doc.date),
    paymentTerms: doc.paymentTerms,
    customer: { ...customer.bill, address: doc.address ?? customer.bill.address, representative: doc.representative ?? customer.bill.representative },
    project: doc.project,
    lines: doc.lines.map((line) => ({ description: line.description, detail: line.detail, qty: 1, unitPriceMinor: rupees(line.rupees) })),
    projectTaxableMinor: doc.projectTaxable ? rupees(doc.projectTaxable) : undefined,
    advanceTaxableMinor: doc.advanceTaxable ? rupees(doc.advanceTaxable) : undefined,
    adjustmentNote: doc.adjustmentNote,
  });
  if (!parsed.success) {
    problems += 1;
    console.log(`✗ ${doc.docNo}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
    return null;
  }
  return { doc, input: parsed.data };
});

console.log('Document totals against the register:');
for (const entry of built) {
  if (!entry) continue;
  const stub = { ...entry.input, series: entry.doc.docType === 'advance' ? 'ADV' : 'INV', serial: entry.doc.serial, supplyType: 'inter', paymentStatus: '', terms: [], gstTreatment: '', lines: entry.input.lines.map((l) => ({ description: l.description, qty: l.qty, taxableMinor: l.qty * l.unitPriceMinor })), advanceTaxableMinor: entry.input.advanceTaxableMinor, projectTaxableMinor: entry.input.projectTaxableMinor } as never;
  const grand = computeTotals(stub).grandMinor;
  const ok = grand === rupees(entry.doc.grossRupees);
  if (!ok) problems += 1;
  console.log(`${ok ? '✓' : '✗'} ${entry.doc.docNo}  ${(grand / 100).toFixed(2)}  register ${entry.doc.grossRupees.toFixed(2)}`);
}
if (problems > 0) {
  console.log(`${problems} problem(s). Nothing was written.`);
  await pool.end();
  process.exit(1);
}
if (dryRun) {
  console.log('Dry run finished. Nothing was written.');
  await pool.end();
  process.exit(0);
}

// ---- write
const workspaceRows = await db.select({ id: workspaces.id }).from(workspaces);
if (workspaceRows.length !== 1) throw new Error(`Expected exactly one workspace, found ${workspaceRows.length}`);
const workspaceId = workspaceRows[0].id;
const storage = await resolveStorage(workspaceId);
if (pdfDir && storage.mode !== 's3') throw new Error('R2 is not connected, so the PDFs cannot be stored there.');

for (const customer of Object.values(customers)) {
  await db
    .insert(clients)
    .values({
      id: `client-legacy-${customer.key}`,
      workspaceId,
      name: customer.name,
      company: customer.company,
      phone: customer.phone ?? '',
      city: customer.city,
      notes: customer.notes,
    })
    .onConflictDoNothing();
}
console.log(`Clients ready: ${Object.keys(customers).length}`);

for (const entry of built) {
  if (!entry) continue;
  const { doc, input } = entry;
  const result = await importLegacyGstInvoice(workspaceId, input, { serial: doc.serial, status: doc.status, expectedDocNo: doc.docNo });
  if (doc.payment) {
    await db
      .insert(payments)
      .values({
        id: `payment-legacy-${doc.docNo.replace(/\W+/g, '-')}`,
        workspaceId,
        invoiceId: result.id,
        amountMinor: rupees(doc.grossRupees),
        currency: 'INR',
        receivedAt: at(doc.payment.date),
        method: doc.payment.method,
        note: doc.payment.note ?? '',
      })
      .onConflictDoNothing();
  }
  let pdfNote = '';
  if (pdfDir && doc.file && storage.mode === 's3') {
    const path = `${pdfDir}/${doc.file}.pdf`;
    if (!existsSync(path)) throw new Error(`Missing ${path}`);
    const loaded = await loadGstInvoice(workspaceId, result.id);
    const key = frozenKey(workspaceId, loaded.docNo, invoiceFileName(loaded.model, 'pdf'));
    if (await headObjectInBucket(storage.config, key)) pdfNote = 'PDF already in R2';
    else {
      const original = await readFile(path);
      const packed = await optimizePdf(original);
      await putObjectToBucket(storage.config, key, packed, 'application/pdf', { frozen: 'true', docNo: loaded.docNo, source: 'imported' });
      pdfNote = `PDF ${(original.length / 1024).toFixed(0)} KB -> ${(packed.length / 1024).toFixed(0)} KB in R2`;
    }
  }
  console.log(`${result.created ? 'added  ' : 'already'} ${doc.docNo} ${doc.status}${doc.payment ? ' + payment' : ''} ${pdfNote}`);
}

await pool.end();
process.exit(0);
