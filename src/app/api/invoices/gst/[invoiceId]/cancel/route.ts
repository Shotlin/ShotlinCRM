import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { verifySameOrigin } from '@/server/http/security';
import { publishChange } from '@/server/realtime';
import { cancelGstInvoice } from '@/server/services/invoicing/issue';
import { cancelInputSchema } from '@/server/services/invoicing/validate';

export async function POST(request: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { invoiceId } = await params;

  const parsed = cancelInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Give a reason' }, { status: 400 });
  }
  try {
    const result = await cancelGstInvoice(context.workspaceId, invoiceId, parsed.data.reason);
    await publishChange(context.workspaceId, 'invoice.cancelled', invoiceId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invoice could not be cancelled' }, { status: 409 });
  }
}
