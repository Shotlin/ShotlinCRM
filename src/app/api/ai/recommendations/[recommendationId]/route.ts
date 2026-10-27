import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/server/auth/config';
import { verifySameOrigin } from '@/server/http/security';
import { publishChange } from '@/server/realtime';
import { setRecommendationState } from '@/server/services/ai/recommendations';

const schema = z.object({
  action: z.enum(['snooze', 'dismiss', 'reopen']),
  hours: z.number().int().min(1).max(168).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ recommendationId: string }> },
) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  const { recommendationId } = await params;
  const updated = await setRecommendationState(
    context.workspaceId,
    recommendationId,
    parsed.data.action,
    parsed.data.hours,
  );
  if (!updated) return NextResponse.json({ error: 'Recommendation not found' }, { status: 404 });
  await publishChange(context.workspaceId, 'ai.recommendation.updated', recommendationId);
  return NextResponse.json({ ok: true });
}
