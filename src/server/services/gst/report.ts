// GST by quarter and month, built from the GST invoices. Pure maths: all money is integer paise.
//
// Which quarter a document belongs to:
//  - tax invoices (final / regular): the invoice date
//  - advance receipts: the date the advance was fully received (GST on an advance is due when it is received)
// Unpaid advances, drafts and cancelled invoices are left out of the totals and listed separately.

export type ReportDoc = {
  docNo: string;
  docType: 'advance' | 'final' | 'regular';
  status: string;
  cancelled: boolean;
  issuedAt: Date;
  client: string;
  gstin: string | null;
  stateName: string;
  stateCode: string;
  project: string;
  taxRatePct: number;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  taxMinor: number;
  grandMinor: number;
  receivedMinor: number;
  lastPaidAt: Date | null;
  advanceTaxableMinor: number;
  advanceRef: string | null;
};

export type ReportExpense = { date: Date; gstMinor: number; itcEligible: boolean };

export type Bucket = { count: number; taxableMinor: number; cgstMinor: number; sgstMinor: number; igstMinor: number; taxMinor: number; grossMinor: number };

export type DocRow = {
  docNo: string;
  docType: ReportDoc['docType'];
  client: string;
  kind: 'B2B' | 'B2C';
  stateName: string;
  countedOn: string;
  monthKey: string;
  taxableMinor: number;
  taxMinor: number;
  grossMinor: number;
  receivedMinor: number;
};

export type Adjustment = {
  docNo: string;
  client: string;
  countedOn: string;
  advanceDocNo: string | null;
  advanceTaxableMinor: number;
  gstAlreadyPaidMinor: number;
  advanceQuarter: string | null;
};

export type OpenAdvance = { docNo: string; client: string; project: string; countedOn: string; quarter: string; taxableMinor: number; gstMinor: number };
export type Excluded = { docNo: string; client: string; docType: ReportDoc['docType']; reason: string; taxableMinor: number; taxMinor: number; grossMinor: number };

export type QuarterReport = {
  id: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  label: string;
  range: string;
  startsOn: string;
  endsOn: string;
  state: 'past' | 'current' | 'upcoming';
  total: Bucket;
  b2b: Bucket;
  b2c: Bucket;
  advances: Bucket;
  finals: Bucket;
  months: { key: string; label: string; total: Bucket; b2b: Bucket; b2c: Bucket; advances: Bucket }[];
  states: { stateName: string; stateCode: string; b2b: Bucket; b2c: Bucket; total: Bucket }[];
  docs: DocRow[];
  adjustments: Adjustment[];
  itcMinor: number;
  // Credit left over from earlier quarters, and what is left after this quarter.
  creditBroughtMinor: number;
  creditLeftMinor: number;
  netPayableMinor: number;
};

export type GstReport = { fy: string; quarters: QuarterReport[]; year: Bucket; openAdvances: OpenAdvance[]; excluded: Excluded[]; itcMinor: number; netPayableMinor: number };

const IST_OFFSET_MS = 5.5 * 3600_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const QUARTERS = [
  { id: 'Q1', months: [4, 5, 6], range: 'Apr – Jun' },
  { id: 'Q2', months: [7, 8, 9], range: 'Jul – Sep' },
  { id: 'Q3', months: [10, 11, 12], range: 'Oct – Dec' },
  { id: 'Q4', months: [1, 2, 3], range: 'Jan – Mar' },
] as const;

const ist = (date: Date) => {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
};
const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (date: Date) => {
  const p = ist(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};
export const fyOf = (date: Date) => {
  const p = ist(date);
  const start = p.month >= 4 ? p.year : p.year - 1;
  return `${pad(start % 100)}-${pad((start + 1) % 100)}`;
};
const quarterOfMonth = (month: number) => QUARTERS.find((q) => (q.months as readonly number[]).includes(month))!;

export const emptyBucket = (): Bucket => ({ count: 0, taxableMinor: 0, cgstMinor: 0, sgstMinor: 0, igstMinor: 0, taxMinor: 0, grossMinor: 0 });
function add(bucket: Bucket, doc: ReportDoc) {
  bucket.count += 1;
  bucket.taxableMinor += doc.taxableMinor;
  bucket.cgstMinor += doc.cgstMinor;
  bucket.sgstMinor += doc.sgstMinor;
  bucket.igstMinor += doc.igstMinor;
  bucket.taxMinor += doc.taxMinor;
  bucket.grossMinor += doc.grandMinor;
}

// The date a document counts in the return, or the reason it does not count.
export function countedDate(doc: ReportDoc): { date: Date } | { reason: string } {
  if (doc.cancelled) return { reason: 'Cancelled' };
  if (doc.status === 'draft') return { reason: 'Draft, not issued yet' };
  if (doc.docType === 'advance') {
    if (doc.receivedMinor >= doc.grandMinor && doc.grandMinor > 0 && doc.lastPaidAt) return { date: doc.lastPaidAt };
    return { reason: 'Advance not received yet' };
  }
  return { date: doc.issuedAt };
}

export function buildGstReport(docs: ReportDoc[], expenses: ReportExpense[], fy: string, now = new Date()): GstReport {
  const startYear = 2000 + Number(fy.slice(0, 2));
  const counted: { doc: ReportDoc; date: Date; quarter: string }[] = [];
  const excluded: Excluded[] = [];

  for (const doc of docs) {
    if (doc.docNo.split('/')[2] !== fy) continue;
    const result = countedDate(doc);
    if ('reason' in result) {
      excluded.push({ docNo: doc.docNo, client: doc.client, docType: doc.docType, reason: result.reason, taxableMinor: doc.taxableMinor, taxMinor: doc.taxMinor, grossMinor: doc.grandMinor });
      continue;
    }
    counted.push({ doc, date: result.date, quarter: quarterOfMonth(ist(result.date).month).id });
  }
  const quarterOfAdvance = new Map(counted.filter((c) => c.doc.docType === 'advance').map((c) => [c.doc.docNo, c.quarter]));

  const nowParts = ist(now);
  const quarters: QuarterReport[] = QUARTERS.map((q) => {
    const firstMonth = q.months[0];
    const year = firstMonth >= 4 ? startYear : startYear + 1;
    const lastMonth = q.months[2];
    const endYear = lastMonth >= 4 ? startYear : startYear + 1;
    const startsOn = `${year}-${pad(firstMonth)}-01`;
    const endDay = new Date(Date.UTC(endYear, lastMonth, 0)).getUTCDate();
    const endsOn = `${endYear}-${pad(lastMonth)}-${pad(endDay)}`;
    const today = `${nowParts.year}-${pad(nowParts.month)}-${pad(nowParts.day)}`;
    const state: QuarterReport['state'] = today > endsOn ? 'past' : today >= startsOn ? 'current' : 'upcoming';

    const mine = counted.filter((c) => c.quarter === q.id);
    const total = emptyBucket(), b2b = emptyBucket(), b2c = emptyBucket(), advances = emptyBucket(), finals = emptyBucket();
    const months = q.months.map((m) => ({
      key: `${m >= 4 ? startYear : startYear + 1}-${pad(m)}`,
      label: `${MONTHS[m - 1]} ${m >= 4 ? startYear : startYear + 1}`,
      total: emptyBucket(), b2b: emptyBucket(), b2c: emptyBucket(), advances: emptyBucket(),
    }));
    const stateMap = new Map<string, QuarterReport['states'][number]>();
    const rows: DocRow[] = [];
    const adjustments: Adjustment[] = [];

    for (const { doc, date } of mine.sort((a, b) => a.date.getTime() - b.date.getTime())) {
      const kind = doc.gstin ? 'B2B' : 'B2C';
      add(total, doc);
      add(kind === 'B2B' ? b2b : b2c, doc);
      add(doc.docType === 'advance' ? advances : finals, doc);
      const month = months.find((m) => m.key === isoDate(date).slice(0, 7))!;
      add(month.total, doc);
      add(kind === 'B2B' ? month.b2b : month.b2c, doc);
      if (doc.docType === 'advance') add(month.advances, doc);
      const entry = stateMap.get(doc.stateCode) ?? { stateName: doc.stateName, stateCode: doc.stateCode, b2b: emptyBucket(), b2c: emptyBucket(), total: emptyBucket() };
      add(entry.total, doc);
      add(kind === 'B2B' ? entry.b2b : entry.b2c, doc);
      stateMap.set(doc.stateCode, entry);
      rows.push({
        docNo: doc.docNo, docType: doc.docType, client: doc.client, kind, stateName: doc.stateName,
        countedOn: isoDate(date), monthKey: isoDate(date).slice(0, 7),
        taxableMinor: doc.taxableMinor, taxMinor: doc.taxMinor, grossMinor: doc.grandMinor, receivedMinor: doc.receivedMinor,
      });
      if (doc.docType === 'final' && doc.advanceTaxableMinor > 0) {
        const advanceDocNo = doc.advanceRef?.match(/SL\/ADV\/\d{2}-\d{2}\/\d+/)?.[0] ?? null;
        adjustments.push({
          docNo: doc.docNo, client: doc.client, countedOn: isoDate(date), advanceDocNo,
          advanceTaxableMinor: doc.advanceTaxableMinor,
          gstAlreadyPaidMinor: Math.round((doc.advanceTaxableMinor * doc.taxRatePct) / 100),
          advanceQuarter: advanceDocNo ? (quarterOfAdvance.get(advanceDocNo) ?? null) : null,
        });
      }
    }
    const itcMinor = expenses
      .filter((e) => e.itcEligible && e.gstMinor > 0 && fyOf(e.date) === fy && quarterOfMonth(ist(e.date).month).id === q.id)
      .reduce((sum, e) => sum + e.gstMinor, 0);
    return {
      id: q.id, label: q.id, range: `${q.range} ${firstMonth >= 4 ? startYear : startYear + 1}`.replace(/ (\d{4})$/, ` ${year}`),
      startsOn, endsOn, state, total, b2b, b2c, advances, finals, months,
      states: [...stateMap.values()].sort((a, b) => b.total.taxableMinor - a.total.taxableMinor),
      docs: rows, adjustments, itcMinor, creditBroughtMinor: 0, creditLeftMinor: 0, netPayableMinor: 0,
    };
  });

  // Unused input credit carries forward into the next quarter.
  let carried = 0;
  for (const q of quarters) {
    const available = q.itcMinor + carried;
    q.creditBroughtMinor = carried;
    q.netPayableMinor = Math.max(q.total.taxMinor - available, 0);
    q.creditLeftMinor = Math.max(available - q.total.taxMinor, 0);
    carried = q.creditLeftMinor;
  }

  const referenced = new Set(counted.filter((c) => c.doc.docType === 'final').map((c) => c.doc.advanceRef?.match(/SL\/ADV\/\d{2}-\d{2}\/\d+/)?.[0]).filter(Boolean));
  const openAdvances: OpenAdvance[] = counted
    .filter((c) => c.doc.docType === 'advance' && !referenced.has(c.doc.docNo))
    .map((c) => ({ docNo: c.doc.docNo, client: c.doc.client, project: c.doc.project, countedOn: isoDate(c.date), quarter: c.quarter, taxableMinor: c.doc.taxableMinor, gstMinor: c.doc.taxMinor }));

  const year = emptyBucket();
  for (const c of counted) add(year, c.doc);
  const itcMinor = quarters.reduce((sum, q) => sum + q.itcMinor, 0);
  return { fy, quarters, year, openAdvances, excluded, itcMinor, netPayableMinor: quarters.reduce((sum, q) => sum + q.netPayableMinor, 0) };
}
