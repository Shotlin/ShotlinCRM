import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { verifySameOrigin } from '@/server/http/security';
import { driveConfigured, markDriveDirty } from '@/server/services/invoicing/driveState';

// "Sync now": flags the invoice, and the worker sends it to Drive within seconds.
export async function POST(request: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!driveConfigured()) return NextResponse.json({ error: 'The Drive link is not set up yet.' }, { status: 409 });
  const { invoiceId } = await params;
  await markDriveDirty(context.workspaceId, invoiceId);
  return NextResponse.json({ ok: true });
}
