// Payment-milestone maths. Safe to import in the browser: no server code in here.
// All money is integer paise. The amount is the truth; the percentage is worked out from it.

export const shareBp = (partMinor: number, wholeMinor: number) => (wholeMinor > 0 ? Math.round((partMinor / wholeMinor) * 10000) : 0);

// Turns percentages (50, 30, 20) into amounts. Any rounding left over goes on the last milestone,
// so the amounts always add up to the whole.
export function splitByPercent(wholeMinor: number, percents: number[]): number[] {
  if (percents.length === 0) return [];
  const amounts = percents.map((pct) => Math.round((wholeMinor * pct) / 100));
  const drift = wholeMinor - amounts.reduce((sum, amount) => sum + amount, 0);
  amounts[amounts.length - 1] += drift;
  return amounts;
}

export const gstOf = (baseMinor: number, ratePct: number) => Math.round((baseMinor * ratePct) / 100);

export function describeMilestones(baseMinor: number, ratePct: number, parts: number[]) {
  return parts.map((part) => ({
    baseMinor: part,
    gstMinor: gstOf(part, ratePct),
    grossMinor: part + gstOf(part, ratePct),
    percent: shareBp(part, baseMinor) / 100,
  }));
}

// What the invoice for one milestone should say. The first milestones are advances; the last one is the final
// invoice and adjusts everything already billed, so the advance is never taxed twice.
export function invoicePlan(parts: number[], index: number) {
  const total = parts.reduce((sum, part) => sum + part, 0);
  const isLast = index === parts.length - 1 && parts.length > 1;
  const before = parts.slice(0, index).reduce((sum, part) => sum + part, 0);
  return isLast
    ? { docType: 'final' as const, projectTaxableMinor: total, advanceTaxableMinor: before, lineMinor: parts[index] }
    : { docType: 'advance' as const, projectTaxableMinor: total, advanceTaxableMinor: parts[index], lineMinor: parts[index] };
}
