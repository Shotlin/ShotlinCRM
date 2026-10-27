import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { verifySameOrigin } from '@/server/http/security';
import { markConversationRead } from '@/server/services/ai/readState';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { leadId } = await params;
  await markConversationRead(context.workspaceId, leadId);
  return NextResponse.json({ ok: true });
}
