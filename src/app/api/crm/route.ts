import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { loadCrmSnapshot } from '@/server/services/crm/load';

export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const snapshot = await loadCrmSnapshot(context.workspaceId);
  return NextResponse.json(snapshot, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
