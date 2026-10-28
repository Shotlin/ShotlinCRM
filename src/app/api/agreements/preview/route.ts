import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { rateLimit } from '@/server/http/rate-limit';
import { verifySameOrigin } from '@/server/http/security';
import { dealInputSchema, previewDeal } from '@/server/services/deals/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Shows the PDF for the form as it is now. Nothing is saved.
export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await rateLimit(`deal-preview:${context.workspaceId}`, 30, 60))) return NextResponse.json({ error: 'Too many previews. Wait a moment.' }, { status: 429 });
  const parsed = dealInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Check the details.' }, { status: 400 });
  try {
    const bytes = await previewDeal(context.workspaceId, parsed.data);
    return new NextResponse(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not build the preview' }, { status: 409 });
  }
}
