import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { loadNumberingState } from '@/server/services/invoicing/numbering';

export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await loadNumberingState(context.workspaceId), { headers: { 'Cache-Control': 'no-store' } });
}
