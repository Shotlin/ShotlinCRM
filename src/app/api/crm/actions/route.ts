import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { applyCrmAction } from '@/server/services/crm/mutations';
import { crmActionSchema } from '@/server/services/crm/schemas';
import { verifySameOrigin } from '@/server/http/security';
import { publishChange } from '@/server/realtime';
import { markDriveDirty } from '@/server/services/invoicing/driveState';

export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  }
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = crmActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid CRM action' }, { status: 400 });
  }

  try {
    const result = await applyCrmAction(context.workspaceId, context.userId, parsed.data);
    // A payment on a GST invoice changes its register row, ledger and PDF status.
    if (parsed.data.type === 'payment.record') {
      await markDriveDirty(context.workspaceId, parsed.data.payload.payment.invoiceId).catch(() => undefined);
    }
    await publishChange(context.workspaceId, 'crm.updated', parsed.data.type);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CRM update failed';
    console.error('CRM action failed', { type: parsed.data.type, message });
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
