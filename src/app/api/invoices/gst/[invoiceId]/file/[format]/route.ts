import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { invoiceFileBytes } from '@/server/services/invoicing/frozen';
import { invoiceFileName, loadGstInvoice } from '@/server/services/invoicing/issue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string; format: string }> },
) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { invoiceId, format } = await params;
  if (format !== 'pdf' && format !== 'docx') return NextResponse.json({ error: 'Unknown format' }, { status: 404 });

  try {
    const invoice = await loadGstInvoice(context.workspaceId, invoiceId);
    const { model } = invoice;
    const bytes = await invoiceFileBytes(context.workspaceId, invoice, format);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': TYPES[format],
        'Content-Length': String(bytes.length),
        'Content-Disposition': `attachment; filename="${invoiceFileName(model, format)}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'GST invoice not found' }, { status: 404 });
  }
}
