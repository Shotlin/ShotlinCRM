import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { verifySameOrigin } from '@/server/http/security';
import { publishChange } from '@/server/realtime';
import { issueGstInvoice } from '@/server/services/invoicing/issue';

export async function POST(request: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { invoiceId } = await params;
  try {
    const result = await issueGstInvoice(context.workspaceId, invoiceId);
    await publishChange(context.workspaceId, 'invoice.issued', invoiceId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invoice could not be issued' }, { status: 409 });
  }
}
