import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { verifySameOrigin } from '@/server/http/security';
import { revokeShareLink } from '@/server/services/share/store';

export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ linkId: string }> }) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await revokeShareLink(context.workspaceId, (await params).linkId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Link not found' }, { status: 404 });
  }
}
