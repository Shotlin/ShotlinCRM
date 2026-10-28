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

export type DraftMilestone = {
  id: string;
  kind: 'agreed' | 'additional';
  title: string;
  baseMinor: number;
  invoice: { number: string; cancelled: boolean } | null;
};

const activeInvoice = (m: DraftMilestone) => Boolean(m.invoice && !m.invoice.cancelled);

// What the invoice for one milestone should contain. Agreed milestones follow the advance-then-final plan;
// an additional charge is an ordinary invoice that leaves the agreed advances alone.
export function milestoneInvoiceDraft(milestones: DraftMilestone[], milestoneId: string, agreementTitle?: string | null) {
  const target = milestones.find((m) => m.id === milestoneId);
  if (!target) return null;
  if (target.kind === 'additional') {
    return {
      docType: 'regular' as const,
      projectTotalMinor: null,
      advanceMinor: null,
      amountMinor: target.baseMinor,
      line: target.title,
      ref: `Additional scope under agreement${agreementTitle ? `: ${agreementTitle}` : ''}`,
      advanceRef: '',
    };
  }
  const agreed = milestones.filter((m) => m.kind === 'agreed');
  const position = agreed.findIndex((m) => m.id === milestoneId);
  const plan = invoicePlan(agreed.map((m) => m.baseMinor), position);
  const before = agreed.slice(0, position).filter(activeInvoice).map((m) => m.invoice!.number).join(', ');
  return {
    docType: plan.docType,
    projectTotalMinor: plan.projectTaxableMinor,
    advanceMinor: plan.advanceTaxableMinor,
    amountMinor: plan.lineMinor,
    line: target.title,
    ref: agreementTitle ? `Agreement: ${agreementTitle}` : '',
    advanceRef: plan.docType === 'final' ? before : '',
  };
}

// The milestone to suggest: the first agreed one not yet invoiced, then any additional charge.
export function nextUnbilledMilestone(milestones: DraftMilestone[]) {
  return milestones.find((m) => m.kind === 'agreed' && !activeInvoice(m)) ?? milestones.find((m) => m.kind === 'additional' && !activeInvoice(m)) ?? null;
}
