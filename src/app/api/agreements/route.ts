import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { verifySameOrigin } from '@/server/http/security';
import { attachDealFile, createDeal, dealInputSchema, listDeals } from '@/server/services/deals/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ deals: await listDeals(context.workspaceId) }, { headers: { 'Cache-Control': 'no-store' } });
}

// Multipart: "data" holds the details as JSON, "file" is the optional PDF.
export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get('data') ?? ''));
  } catch {
    return NextResponse.json({ error: 'Invalid details' }, { status: 400 });
  }
  const parsed = dealInputSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Check the details.' }, { status: 400 });
  try {
    const id = await createDeal(context.workspaceId, parsed.data);
    const file = form.get('file');
    if (file instanceof File && file.size > 0) await attachDealFile(context.workspaceId, id, Buffer.from(await file.arrayBuffer()), file.name);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save' }, { status: 409 });
  }
}
