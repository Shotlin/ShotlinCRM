import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { verifySameOrigin } from '@/server/http/security';
import { attachDealFile, getDealFileKey } from '@/server/services/deals/store';
import { getPrivateMedia } from '@/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ dealId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const file = await getDealFileKey(context.workspaceId, (await params).dealId);
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 404 });
  try {
    const bytes = await getPrivateMedia(file.key);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.length),
        'Content-Disposition': `inline; filename="${file.name.replace(/["\\]/g, '')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'File unavailable' }, { status: 404 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Choose a PDF' }, { status: 400 });
  try {
    const size = await attachDealFile(context.workspaceId, (await params).dealId, Buffer.from(await file.arrayBuffer()), file.name);
    return NextResponse.json({ ok: true, size });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Upload failed' }, { status: 400 });
  }
}
