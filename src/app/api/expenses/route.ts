import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { verifySameOrigin } from '@/server/http/security';
import { createExpense, expenseInputSchema, listExpenses } from '@/server/services/expenses/store';
import { buildExpenseSummary, monthKeyOf } from '@/server/services/expenses/summary';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const current = monthKeyOf(new Date());
  const asked = request.nextUrl.searchParams.get('month') ?? current;
  const month = /^\d{4}-\d{2}$/.test(asked) ? asked : current;
  const rows = await listExpenses(context.workspaceId);
  return NextResponse.json(
    { summary: buildExpenseSummary(rows, month, current), currentMonth: current, entries: rows.filter((r) => monthKeyOf(r.spentAt) === month) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = expenseInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Check the details.' }, { status: 400 });
  return NextResponse.json({ id: await createExpense(context.workspaceId, parsed.data) }, { status: 201 });
}
