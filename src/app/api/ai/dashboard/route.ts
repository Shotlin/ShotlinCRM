import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { loadAiDashboard } from '@/server/services/ai/dashboard';

export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const dashboard = await loadAiDashboard(context.workspaceId);
    return NextResponse.json(dashboard, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'AI dashboard could not be loaded' }, { status: 500 });
  }
}
