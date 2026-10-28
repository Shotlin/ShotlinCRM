import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { db } from '@/server/db/client';
import { leads } from '@/server/db/schema';
import { verifySameOrigin } from '@/server/http/security';
import { publishChange } from '@/server/realtime';

// "Add to pipeline": turns a plain WhatsApp chat into a lead worked in the pipeline.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { leadId } = await params;

  const [updated] = await db
    .update(leads)
    .set({ inPipeline: true, status: 'new', lastActivityAt: new Date() })
    .where(and(eq(leads.id, leadId), eq(leads.workspaceId, context.workspaceId), eq(leads.inPipeline, false)))
    .returning({ id: leads.id });
  if (!updated) {
    const [existing] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.workspaceId, context.workspaceId)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
  }
  await publishChange(context.workspaceId, 'lead.updated', leadId);
  return NextResponse.json({ ok: true });
}
