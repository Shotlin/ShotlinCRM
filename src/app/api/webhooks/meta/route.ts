import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { metaConnections, metaLeadEvents } from '@/server/db/schema';
import { verifyMetaSignature } from '@/server/integrations/meta/signature';
import { hashVerifyToken } from '@/server/integrations/meta/signature';
import { getEnv } from '@/server/env';
import { queueMetaLeadJob } from '@/server/queues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('hub.mode');
  const token = request.nextUrl.searchParams.get('hub.verify_token');
  const challenge = request.nextUrl.searchParams.get('hub.challenge');
  if (mode !== 'subscribe' || !token || !challenge) {
    return new NextResponse('Invalid verification request', { status: 400 });
  }
  const [connection] = await db
    .select({ id: metaConnections.id })
    .from(metaConnections)
    .where(
      and(
        eq(metaConnections.verifyTokenHash, hashVerifyToken(token)),
        eq(metaConnections.status, 'connected'),
      ),
    )
    .limit(1);
  if (!connection) return new NextResponse('Forbidden', { status: 403 });
  return new NextResponse(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  });
}

const leadgenSchema = z.object({
  object: z.literal('page'),
  entry: z.array(
    z.object({
      id: z.string(),
      time: z.number().optional(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.object({
            leadgen_id: z.string().min(1),
            form_id: z.string().optional(),
            ad_id: z.string().optional(),
            created_time: z.union([z.string(), z.number()]).optional(),
          }).passthrough(),
        }),
      ),
    }),
  ),
});

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const appSecret = getEnv().META_APP_SECRET;
  if (!appSecret) {
    return new NextResponse('Meta webhook is not configured', { status: 503 });
  }
  if (!verifyMetaSignature(raw, request.headers.get('x-hub-signature-256'), appSecret)) {
    return new NextResponse('Invalid signature', { status: 401 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 });
  }
  const parsed = leadgenSchema.safeParse(parsedJson);
  if (!parsed.success) return new NextResponse('Unsupported event', { status: 400 });

  for (const entry of parsed.data.entry) {
    const [connection] = await db
      .select({ workspaceId: metaConnections.workspaceId })
      .from(metaConnections)
      .where(
        and(
          eq(metaConnections.pageId, entry.id),
          eq(metaConnections.status, 'connected'),
        ),
      )
      .limit(1);
    if (!connection) continue;

    for (const [index, change] of entry.changes.entries()) {
      if (change.field !== 'leadgen') continue;
      const leadgenId = change.value.leadgen_id;
      const eventId = `${entry.id}:${leadgenId}:${change.value.created_time ?? entry.time ?? index}`;
      const [inserted] = await db
        .insert(metaLeadEvents)
        .values({
          id: randomUUID(),
          workspaceId: connection.workspaceId,
          leadgenId,
          eventId,
        })
        .onConflictDoNothing()
        .returning({ id: metaLeadEvents.id });
      if (inserted) {
        await queueMetaLeadJob(connection.workspaceId, leadgenId);
      } else {
        const [event] = await db
          .select({ state: metaLeadEvents.processingState })
          .from(metaLeadEvents)
          .where(
            and(
              eq(metaLeadEvents.workspaceId, connection.workspaceId),
              eq(metaLeadEvents.leadgenId, leadgenId),
            ),
          )
          .limit(1);
        if (event && event.state !== 'processed') {
          await queueMetaLeadJob(connection.workspaceId, leadgenId);
        }
      }
    }
  }

  return new NextResponse('EVENT_RECEIVED', { status: 200 });
}
