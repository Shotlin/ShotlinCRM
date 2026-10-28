import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { listSignatures } from '@/server/services/deals/signing';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ signatures: await listSignatures(context.workspaceId, (await params).dealId) }, { headers: { 'Cache-Control': 'no-store' } });
}
