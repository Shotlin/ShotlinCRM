import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { verifySameOrigin } from '@/server/http/security';
import { dealInputSchema, deleteDeal, getDeal, updateDeal } from '@/server/services/deals/store';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ dealId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const deal = await getDeal(context.workspaceId, (await params).dealId);
  return deal ? NextResponse.json(deal, { headers: { 'Cache-Control': 'no-store' } }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function PUT(request: NextRequest, { params }: Params) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = dealInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Check the details.' }, { status: 400 });
  try {
    await updateDeal(context.workspaceId, (await params).dealId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save' }, { status: 409 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await deleteDeal(context.workspaceId, (await params).dealId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not delete' }, { status: 409 });
  }
}
