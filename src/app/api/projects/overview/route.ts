import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { listProjectsWithProgress } from '@/server/services/deals/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ projects: await listProjectsWithProgress(context.workspaceId) }, { headers: { 'Cache-Control': 'no-store' } });
}
