import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { verifySameOrigin } from '@/server/http/security';
import { deleteExpense, expenseInputSchema, updateExpense } from '@/server/services/expenses/store';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ expenseId: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = expenseInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Check the details.' }, { status: 400 });
  try {
    await updateExpense(context.workspaceId, (await params).expenseId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Expense not found' }, { status: 404 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await deleteExpense(context.workspaceId, (await params).expenseId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Expense not found' }, { status: 404 });
  }
}
