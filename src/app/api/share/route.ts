import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/server/auth/config';
import { rateLimit } from '@/server/http/rate-limit';
import { verifySameOrigin } from '@/server/http/security';
import { createShareLink, listShareLinks } from '@/server/services/share/store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const targetId = request.nextUrl.searchParams.get('targetId');
  if (!targetId) return NextResponse.json({ links: [] });
  return NextResponse.json({ links: await listShareLinks(context.workspaceId, targetId) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (context.role !== 'owner') return NextResponse.json({ error: 'Only an owner can create client links.' }, { status: 403 });
  if (!(await rateLimit(`share-create:${context.workspaceId}`, 20, 60))) return NextResponse.json({ error: 'Too many links. Wait a minute.' }, { status: 429 });
  const parsed = z.object({ targetId: z.string().min(1), label: z.string().trim().max(120).default(''), days: z.number().int().min(1).max(180).default(30) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Check the details.' }, { status: 400 });
  try {
    const link = await createShareLink(context.workspaceId, parsed.data.targetId, parsed.data.label, parsed.data.days);
    const base = (process.env.PUBLIC_BASE_URL ?? process.env.AUTH_URL ?? request.nextUrl.origin).replace(/\/$/, '');
    return NextResponse.json({ id: link.id, url: `${base}/s/${link.token}`, expiresAt: link.expiresAt }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not create the link' }, { status: 409 });
  }
}
