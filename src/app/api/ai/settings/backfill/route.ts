import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { rateLimit } from '@/server/http/rate-limit';
import { verifySameOrigin } from '@/server/http/security';
import { enqueueBackfill } from '@/server/services/ai/runs';

export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (context.role !== 'owner') {
    return NextResponse.json({ error: 'Only the workspace owner can analyze history' }, { status: 403 });
  }
  if (!(await rateLimit(`ai-backfill:${context.workspaceId}`, 3, 60))) {
    return NextResponse.json({ error: 'Backfill was requested recently' }, { status: 429 });
  }
  try {
    const result = await enqueueBackfill(context.workspaceId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'History could not be queued' },
      { status: 409 },
    );
  }
}
