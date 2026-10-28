import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { verifySameOrigin } from '@/server/http/security';
import { publishChange } from '@/server/realtime';
import { createGstInvoice } from '@/server/services/invoicing/issue';
import { gstInvoiceInputSchema } from '@/server/services/invoicing/validate';

export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = gstInvoiceInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? 'Invalid invoice',
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
      { status: 400 },
    );
  }
  try {
    const created = await createGstInvoice(context.workspaceId, parsed.data);
    await publishChange(context.workspaceId, 'invoice.created', created.id);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invoice could not be created' }, { status: 409 });
  }
}
