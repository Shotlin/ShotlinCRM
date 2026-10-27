import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/server/auth/config';
import { rateLimit } from '@/server/http/rate-limit';
import { verifySameOrigin } from '@/server/http/security';
import { generateReplyDraft, listReplyDrafts } from '@/server/services/ai/drafts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const drafts = await listReplyDrafts(context.workspaceId);
  return NextResponse.json({ drafts }, { headers: { 'Cache-Control': 'no-store' } });
}

const schema = z.object({
  leadId: z.string().min(1).max(200),
  instruction: z.string().max(500).optional(),
  force: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await rateLimit(`ai-draft:${context.workspaceId}`, 10, 60))) {
    return NextResponse.json({ error: 'Too many draft requests' }, { status: 429 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid draft request' }, { status: 400 });
  try {
    const draft = await generateReplyDraft(context.workspaceId, parsed.data.leadId, {
      instruction: parsed.data.instruction,
      force: parsed.data.force,
    });
    return NextResponse.json({ draft });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Reply draft could not be generated' },
      { status: 409 },
    );
  }
}
