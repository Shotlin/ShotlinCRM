import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/server/auth/config';
import { db } from '@/server/db/client';
import { clients, leads, projects } from '@/server/db/schema';
import { verifySameOrigin } from '@/server/http/security';
import { publishChange } from '@/server/realtime';

export const dynamic = 'force-dynamic';

const iso = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date');

export async function GET(request: NextRequest) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const leadId = request.nextUrl.searchParams.get('leadId');
  const rows = await db
    .select()
    .from(projects)
    .where(
      leadId
        ? and(eq(projects.workspaceId, context.workspaceId), eq(projects.leadId, leadId))
        : eq(projects.workspaceId, context.workspaceId),
    );
  return NextResponse.json(
    {
      projects: rows.map((project) => ({
        id: project.id,
        title: project.title,
        status: project.status,
        startsAt: project.startsAt?.toISOString() ?? null,
        dueAt: project.dueAt.toISOString(),
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

const schema = z.object({
  id: z.string().min(1).max(200).optional(),
  leadId: z.string().min(1).max(200),
  clientId: z.string().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(300),
  status: z.enum(['active', 'on_hold', 'completed', 'cancelled']),
  startsAt: iso.optional().nullable(),
  dueAt: iso,
});

export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Add a title and a valid project deadline' }, { status: 400 });
  }
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, parsed.data.leadId), eq(leads.workspaceId, context.workspaceId)))
    .limit(1);
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  const clientId = parsed.data.clientId ?? lead.clientId;
  if (!clientId) {
    return NextResponse.json(
      { error: 'Convert this lead to a client before adding a project deadline' },
      { status: 409 },
    );
  }
  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.workspaceId, context.workspaceId)))
    .limit(1);
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const now = new Date();
  const completedAt = parsed.data.status === 'completed' ? now : null;
  if (parsed.data.id) {
    const [existing] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, parsed.data.id),
          eq(projects.workspaceId, context.workspaceId),
        ),
      )
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    await db
      .update(projects)
      .set({
        clientId,
        leadId: lead.id,
        title: parsed.data.title,
        status: parsed.data.status,
        startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null,
        dueAt: new Date(parsed.data.dueAt),
        completedAt,
        updatedAt: now,
      })
      .where(and(eq(projects.id, parsed.data.id), eq(projects.workspaceId, context.workspaceId)));
  } else {
    await db.insert(projects).values({
      id: randomUUID(),
      workspaceId: context.workspaceId,
      clientId,
      leadId: lead.id,
      title: parsed.data.title,
      status: parsed.data.status,
      startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null,
      dueAt: new Date(parsed.data.dueAt),
      completedAt,
    });
  }
  await publishChange(context.workspaceId, 'project.saved', lead.id);
  return NextResponse.json({ ok: true });
}
