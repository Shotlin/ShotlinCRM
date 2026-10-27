import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { seedDemoCrm } from '@/server/services/crm/seed';
import { verifySameOrigin } from '@/server/http/security';
import { publishChange } from '@/server/realtime';

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Demo reset is disabled in production' }, { status: 404 });
  }
  if (!verifySameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  }
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (context.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await seedDemoCrm(context.workspaceId, { replace: true });
  await publishChange(context.workspaceId, 'crm.reset');
  return NextResponse.json({ ok: true });
}
