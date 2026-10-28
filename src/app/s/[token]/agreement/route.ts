import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/server/db/client';
import { projects } from '@/server/db/schema';
import { rateLimit } from '@/server/http/rate-limit';
import { getDealFileKey } from '@/server/services/deals/store';
import { resolveShare } from '@/server/services/share/store';
import { getPrivateMedia } from '@/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const gone = () => new NextResponse('This link is no longer available.', { status: 404, headers: { 'Cache-Control': 'no-store' } });

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!(await rateLimit(`share-file:${ip}`, 40, 60))) return new NextResponse('Too many requests.', { status: 429 });
  const link = await resolveShare(token);
  if (!link || (link.kind !== 'project' && link.kind !== 'agreement')) return gone();
  let documentId: string | null = null;
  if (link.kind === 'agreement') documentId = link.targetId;
  else {
    const [project] = await db.select({ agreementId: projects.agreementId }).from(projects).where(eq(projects.id, link.targetId)).limit(1);
    documentId = project?.agreementId ?? null;
  }
  const file = documentId ? await getDealFileKey(link.workspaceId, documentId) : null;
  if (!file) return gone();
  try {
    const bytes = await getPrivateMedia(file.key);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.length),
        'Content-Disposition': `inline; filename="${file.name.replace(/["\\]/g, '')}"`,
        'X-Frame-Options': 'SAMEORIGIN',
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch {
    return gone();
  }
}
