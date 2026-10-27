import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { z } from 'zod';
import { getAuthContext } from '@/server/auth/config';
import { db } from '@/server/db/client';
import { whatsappConnections } from '@/server/db/schema';
import { verifySameOrigin } from '@/server/http/security';
import { getPublisher } from '@/server/realtime';
import { signalWhatsAppControl } from '@/server/queues';
import { decryptSecret } from '@/server/security/envelope';

export const dynamic = 'force-dynamic';

async function workerStatus() {
  const value = await getPublisher().get('shotlin:worker:heartbeat');
  if (!value) return { online: false, transport: 'unknown' };
  try {
    const parsed = JSON.parse(value) as { at: string; transport?: string };
    return {
      online: Date.now() - new Date(parsed.at).getTime() < 30_000,
      transport: parsed.transport ?? 'live',
    };
  } catch {
    return { online: false, transport: 'unknown' };
  }
}

export async function GET() {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [connection] = await db
    .select()
    .from(whatsappConnections)
    .where(eq(whatsappConnections.workspaceId, context.workspaceId))
    .limit(1);
  const worker = await workerStatus();

  let qrDataUrl: string | null = null;
  if (
    connection?.qrCiphertext &&
    connection.qrExpiresAt &&
    connection.qrExpiresAt.getTime() > Date.now()
  ) {
    try {
      qrDataUrl = await QRCode.toDataURL(decryptSecret(connection.qrCiphertext), {
        margin: 2,
        width: 320,
        color: { dark: '#111111', light: '#ffffff' },
      });
    } catch {
      qrDataUrl = null;
    }
  }

  return NextResponse.json(
    {
      state: connection?.state ?? 'disconnected',
      phone: connection?.phone ?? null,
      connectedAt: connection?.connectedAt?.toISOString() ?? null,
      qrDataUrl,
      qrExpiresAt: connection?.qrExpiresAt?.toISOString() ?? null,
      lastError: connection?.lastError ?? null,
      workerOnline: worker.online,
      transport: worker.transport,
      unofficial: true,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

const actionSchema = z.object({
  action: z.enum(['pair', 'disconnect', 'logout']),
});

export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  if (context.role !== 'owner') {
    return NextResponse.json({ error: 'Only the workspace owner can change WhatsApp' }, { status: 403 });
  }
  if (!(await workerStatus()).online) {
    return NextResponse.json(
      { error: 'The WhatsApp worker is offline. Start it with npm run worker.' },
      { status: 503 },
    );
  }

  if (parsed.data.action === 'pair') {
    const [existing] = await db
      .select()
      .from(whatsappConnections)
      .where(eq(whatsappConnections.workspaceId, context.workspaceId))
      .limit(1);
    if (existing?.state === 'connected') {
      return NextResponse.json({ ok: true, state: 'connected' });
    }
    const nextGeneration = (existing?.generation ?? 0) + 1;
    await db
      .insert(whatsappConnections)
      .values({
        id: crypto.randomUUID(),
        workspaceId: context.workspaceId,
        state: 'connecting',
        generation: nextGeneration,
      })
      .onConflictDoUpdate({
        target: whatsappConnections.workspaceId,
        set: {
          state: 'connecting',
          generation: nextGeneration,
          qrCiphertext: null,
          qrExpiresAt: null,
          lastError: null,
          updatedAt: new Date(),
        },
      });
  }

  const control =
    parsed.data.action === 'pair'
      ? 'start'
      : parsed.data.action === 'disconnect'
        ? 'disconnect'
        : 'logout';
  await signalWhatsAppControl(context.workspaceId, control);
  return NextResponse.json({ ok: true });
}
