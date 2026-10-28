import { categoryOf } from './categories';

export type ExpenseRow = {
  id: string;
  spentAt: Date;
  title: string;
  category: string;
  payeeName: string;
  payeeType: string;
  amountMinor: number;
  gstMinor: number;
  itcEligible: boolean;
  planned: boolean;
  recurring: boolean;
  method: string;
  note: string;
};

const IST_OFFSET_MS = 5.5 * 3600_000;
export const monthKeyOf = (date: Date) => new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 7);
const shiftMonth = (key: string, by: number) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export type ExpenseSummary = {
  month: string;
  totalMinor: number;
  plannedMinor: number;
  unplannedMinor: number;
  previousTotalMinor: number;
  count: number;
  gstMinor: number;
  series: { month: string; totalMinor: number; plannedMinor: number; unplannedMinor: number }[];
  byCategory: { id: string; label: string; color: string; totalMinor: number; count: number }[];
  byPayee: { name: string; type: string; totalMinor: number; count: number }[];
  unplanned: ExpenseRow[];
  // Repeating bills that have not been entered yet this month.
  dueThisMonth: { title: string; category: string; payeeName: string; payeeType: string; lastAmountMinor: number; lastSpentAt: Date }[];
  payees: { name: string; type: string }[];
};

export function buildExpenseSummary(rows: ExpenseRow[], month: string, currentMonth: string): ExpenseSummary {
  const inMonth = rows.filter((r) => monthKeyOf(r.spentAt) === month);
  const sum = (list: ExpenseRow[]) => list.reduce((s, r) => s + r.amountMinor, 0);
  const previous = rows.filter((r) => monthKeyOf(r.spentAt) === shiftMonth(month, -1));

  const series = Array.from({ length: 12 }, (_, i) => shiftMonth(month, i - 11)).map((key) => {
    const list = rows.filter((r) => monthKeyOf(r.spentAt) === key);
    return { month: key, totalMinor: sum(list), plannedMinor: sum(list.filter((r) => r.planned)), unplannedMinor: sum(list.filter((r) => !r.planned)) };
  });

  const cat = new Map<string, { totalMinor: number; count: number }>();
  const payee = new Map<string, { name: string; type: string; totalMinor: number; count: number }>();
  for (const r of inMonth) {
    const c = cat.get(r.category) ?? { totalMinor: 0, count: 0 };
    c.totalMinor += r.amountMinor; c.count += 1; cat.set(r.category, c);
    const key = r.payeeName.trim().toLowerCase();
    const p = payee.get(key) ?? { name: r.payeeName, type: r.payeeType, totalMinor: 0, count: 0 };
    p.totalMinor += r.amountMinor; p.count += 1; payee.set(key, p);
  }

  // The latest entry of every repeating bill; due if that entry is from before this month.
  const latest = new Map<string, ExpenseRow>();
  for (const r of rows.filter((x) => x.recurring)) {
    const key = `${r.title.trim().toLowerCase()}|${r.payeeName.trim().toLowerCase()}`;
    const have = latest.get(key);
    if (!have || r.spentAt > have.spentAt) latest.set(key, r);
  }
  const dueThisMonth =
    month === currentMonth
      ? [...latest.values()]
          .filter((r) => monthKeyOf(r.spentAt) < month)
          .map((r) => ({ title: r.title, category: r.category, payeeName: r.payeeName, payeeType: r.payeeType, lastAmountMinor: r.amountMinor, lastSpentAt: r.spentAt }))
      : [];

  const seen = new Map<string, { name: string; type: string }>();
  for (const r of [...rows].sort((a, b) => b.spentAt.getTime() - a.spentAt.getTime())) {
    const key = r.payeeName.trim().toLowerCase();
    if (!seen.has(key)) seen.set(key, { name: r.payeeName, type: r.payeeType });
  }

  return {
    month,
    totalMinor: sum(inMonth),
    plannedMinor: sum(inMonth.filter((r) => r.planned)),
    unplannedMinor: sum(inMonth.filter((r) => !r.planned)),
    previousTotalMinor: sum(previous),
    count: inMonth.length,
    gstMinor: inMonth.reduce((s, r) => s + r.gstMinor, 0),
    series,
    byCategory: [...cat.entries()]
      .map(([id, v]) => ({ id, label: categoryOf(id).label, color: categoryOf(id).color, ...v }))
      .sort((a, b) => b.totalMinor - a.totalMinor),
    byPayee: [...payee.values()].sort((a, b) => b.totalMinor - a.totalMinor),
    unplanned: inMonth.filter((r) => !r.planned),
    dueThisMonth,
    payees: [...seen.values()],
  };
}
