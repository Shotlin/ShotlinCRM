import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/server/auth/config';
import { verifySameOrigin } from '@/server/http/security';
import { getReplyDraft, updateReplyDraft } from '@/server/services/ai/drafts';

const schema = z.object({ body: z.string().trim().min(1).max(8_000) });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { draftId } = await params;
  const draft = await getReplyDraft(context.workspaceId, draftId);
  if (!draft) return NextResponse.json({ error: 'Reply draft not found' }, { status: 404 });
  return NextResponse.json({ draft }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Write a reply before saving' }, { status: 400 });
  const { draftId } = await params;
  try {
    const draft = await updateReplyDraft(context.workspaceId, draftId, parsed.data.body);
    return NextResponse.json({ draft });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Draft could not be saved' },
      { status: 409 },
    );
  }
}
