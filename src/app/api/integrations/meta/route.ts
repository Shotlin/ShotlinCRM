import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getAuthContext } from '@/server/auth/config';
import { db } from '@/server/db/client';
import { metaConnections } from '@/server/db/schema';
import { verifyMetaPage } from '@/server/integrations/meta/graph';
import { hashVerifyToken } from '@/server/integrations/meta/signature';
import { verifySameOrigin } from '@/server/http/security';
import { encryptSecret } from '@/server/security/envelope';

export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [connection] = await db
    .select({
      pageId: metaConnections.pageId,
      status: metaConnections.status,
      updatedAt: metaConnections.updatedAt,
    })
    .from(metaConnections)
    .where(eq(metaConnections.workspaceId, context.workspaceId))
    .limit(1);
  return NextResponse.json(
    {
      configured: Boolean(connection),
      pageId: connection?.pageId ?? null,
      status: connection?.status ?? 'disconnected',
      updatedAt: connection?.updatedAt?.toISOString() ?? null,
      appSecretConfigured: Boolean(process.env.META_APP_SECRET),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

const connectSchema = z.object({
  pageId: z.string().regex(/^\d{5,30}$/),
  accessToken: z.string().min(20).max(2_000),
  verifyToken: z.string().min(12).max(200),
});

export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (context.role !== 'owner') {
    return NextResponse.json({ error: 'Only the workspace owner can connect Meta' }, { status: 403 });
  }
  if (!process.env.META_APP_SECRET) {
    return NextResponse.json(
      { error: 'Set META_APP_SECRET on the server before connecting Meta.' },
      { status: 503 },
    );
  }
  const parsed = connectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a page ID, page access token, and verify token' }, { status: 400 });
  }

  try {
    await verifyMetaPage(parsed.data.pageId, parsed.data.accessToken, parsed.data.verifyToken);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Meta verification failed' },
      { status: 400 },
    );
  }

  const encryptedAccessToken = encryptSecret(parsed.data.accessToken);
  await db
    .insert(metaConnections)
    .values({
      id: randomUUID(),
      workspaceId: context.workspaceId,
      pageId: parsed.data.pageId,
      encryptedAccessToken,
      verifyTokenHash: hashVerifyToken(parsed.data.verifyToken),
    })
    .onConflictDoUpdate({
      target: metaConnections.workspaceId,
      set: {
        pageId: parsed.data.pageId,
        encryptedAccessToken,
        verifyTokenHash: hashVerifyToken(parsed.data.verifyToken),
        status: 'connected',
        updatedAt: new Date(),
      },
    });
  const webhookUrl = `${request.nextUrl.origin}/api/webhooks/meta`;
  return NextResponse.json({ ok: true, webhookUrl });
}

export async function DELETE(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (context.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  await db
    .delete(metaConnections)
    .where(and(eq(metaConnections.workspaceId, context.workspaceId)));
  return NextResponse.json({ ok: true });
}
