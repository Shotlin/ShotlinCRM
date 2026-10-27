import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { db } from '@/server/db/client';
import { messageMedia } from '@/server/db/schema';
import { getPrivateMedia } from '@/server/storage';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mediaId: string }> },
) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { mediaId } = await params;

  const [media] = await db
    .select()
    .from(messageMedia)
    .where(and(eq(messageMedia.id, mediaId), eq(messageMedia.workspaceId, context.workspaceId)))
    .limit(1);
  if (!media || media.state !== 'ready') {
    return NextResponse.json({ error: 'Media not found' }, { status: 404 });
  }

  try {
    const buffer = await getPrivateMedia(media.objectKey);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': media.mimeType,
        'Content-Length': String(buffer.length),
        'Content-Disposition': `inline; filename="${(media.filename ?? 'attachment').replace(/["\\]/g, '')}"`,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Media unavailable' }, { status: 404 });
  }
}
