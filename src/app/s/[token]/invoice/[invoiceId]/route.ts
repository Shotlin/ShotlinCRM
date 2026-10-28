import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { rateLimit } from '@/server/http/rate-limit';
import { invoiceFileBytes } from '@/server/services/invoicing/frozen';
import { invoiceFileName, loadGstInvoice } from '@/server/services/invoicing/issue';
import { invoiceAllowedForLink, resolveShare } from '@/server/services/share/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const gone = () => new NextResponse('This link is no longer available.', { status: 404, headers: { 'Cache-Control': 'no-store' } });

export async function GET(_request: Request, { params }: { params: Promise<{ token: string; invoiceId: string }> }) {
  const { token, invoiceId } = await params;
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!(await rateLimit(`share-file:${ip}`, 40, 60))) return new NextResponse('Too many requests.', { status: 429 });
  const link = await resolveShare(token);
  if (!link || !(await invoiceAllowedForLink(link, invoiceId))) return gone();
  try {
    const invoice = await loadGstInvoice(link.workspaceId, invoiceId);
    if (invoice.status === 'draft' || invoice.cancelled) return gone();
    const bytes = await invoiceFileBytes(link.workspaceId, invoice, 'pdf');
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.length),
        'Content-Disposition': `inline; filename="${invoiceFileName(invoice.model, 'pdf')}"`,
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch {
    return gone();
  }
}
