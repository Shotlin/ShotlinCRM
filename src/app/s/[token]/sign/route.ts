import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { rateLimit } from '@/server/http/rate-limit';
import { verifySameOrigin } from '@/server/http/security';
import { requestChanges, submitClientSignature } from '@/server/services/deals/signing';
import { resolveShare } from '@/server/services/share/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sign'), name: z.string().max(120), title: z.string().max(120).default(''), signature: z.string().max(600_000), consent: z.boolean() }),
  z.object({ action: z.literal('changes'), name: z.string().max(120).default(''), message: z.string().max(2000) }),
]);

// The signing link is the only credential. It is rate limited and refuses requests that come from another site.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!verifySameOrigin(request as never)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const { token } = await params;
  const requestHeaders = await headers();
  const ip = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!(await rateLimit(`share-sign:${ip}`, 12, 60))) return NextResponse.json({ error: 'Too many attempts. Wait a minute.' }, { status: 429 });
  const link = await resolveShare(token);
  if (!link || link.kind !== 'agreement') return NextResponse.json({ error: 'This link is no longer available.' }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Check your details and try again.' }, { status: 400 });
  try {
    if (parsed.data.action === 'sign') {
      await submitClientSignature(link, {
        name: parsed.data.name,
        title: parsed.data.title,
        signatureDataUrl: parsed.data.signature,
        consent: parsed.data.consent,
        ip,
        userAgent: requestHeaders.get('user-agent') ?? '',
      });
    } else {
      await requestChanges(link, parsed.data.name, parsed.data.message);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save your signature' }, { status: 409 });
  }
}
