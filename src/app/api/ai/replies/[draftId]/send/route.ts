import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { rateLimit } from '@/server/http/rate-limit';
import { verifySameOrigin } from '@/server/http/security';
import { sendReplyDraft } from '@/server/services/ai/drafts';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await rateLimit(`send:${context.workspaceId}`, 30, 60))) {
    return NextResponse.json({ error: 'Too many messages. Wait a moment before sending again.' }, { status: 429 });
  }
  const { draftId } = await params;
  try {
    const result = await sendReplyDraft(context.workspaceId, draftId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Draft could not be sent' },
      { status: 409 },
    );
  }
}
