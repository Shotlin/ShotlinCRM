import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { verifySameOrigin } from '@/server/http/security';
import { publishChange } from '@/server/realtime';
import { driveConfigured } from '@/server/services/invoicing/driveState';
import { archiveFrozenMasters } from '@/server/services/invoicing/frozen';
import { loadGstInvoice, updateGstInvoice } from '@/server/services/invoicing/issue';
import { gstInvoiceInputSchema } from '@/server/services/invoicing/validate';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { invoiceId } = await params;
  try {
    const loaded = await loadGstInvoice(context.workspaceId, invoiceId);
    return NextResponse.json({
      docNo: loaded.docNo,
      clientId: loaded.clientId,
      status: loaded.status,
      cancelled: loaded.cancelled,
      receivedMinor: loaded.receivedMinor,
      grandMinor: loaded.totals.grandMinor,
      invoice: loaded.model,
      drive: {
        configured: driveConfigured(),
        state: loaded.drive?.state ?? null,
        pdfUrl: loaded.drive?.pdfUrl ?? null,
        docxUrl: loaded.drive?.docxUrl ?? null,
        folderName: loaded.drive?.folderName ?? null,
        syncedAt: loaded.drive?.syncedAt ?? null,
        error: loaded.drive?.error ?? null,
      },
    });
  } catch {
    return NextResponse.json({ error: 'GST invoice not found' }, { status: 404 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { invoiceId } = await params;

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
    // "amend" and "reason" ride along with the invoice fields when an issued invoice is being changed.
    const extra = body as { amend?: unknown; reason?: unknown };
    const amend = extra.amend === true;
    const reason = typeof extra.reason === 'string' ? extra.reason : '';
    const before = amend ? await loadGstInvoice(context.workspaceId, invoiceId).catch(() => null) : null;
    const updated = await updateGstInvoice(context.workspaceId, invoiceId, parsed.data, { amend, reason });
    // The old PDF and Word master are filed away, so the next download shows the amended invoice.
    if (before && updated.revision) await archiveFrozenMasters(context.workspaceId, before, updated.revision).catch(() => undefined);
    await publishChange(context.workspaceId, 'invoice.updated', invoiceId);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invoice could not be updated' }, { status: 409 });
  }
}
