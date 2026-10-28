import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getAuthContext } from '@/server/auth/config';
import { db } from '@/server/db/client';
import { dealDocuments } from '@/server/db/schema';
import { verifySameOrigin } from '@/server/http/security';
import { countersign } from '@/server/services/deals/signing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), name: z.string().max(120).default(''), title: z.string().max(120).default('') }),
  z.object({ action: z.literal('resend') }),
]);

// You review what the client signed and approve it, or send it back out after dealing with their change request.
export async function POST(request: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (context.role !== 'owner') return NextResponse.json({ error: 'Only an owner can approve agreements.' }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Check the details.' }, { status: 400 });
  const { dealId } = await params;
  try {
    if (parsed.data.action === 'approve') await countersign(context.workspaceId, dealId, { name: parsed.data.name, title: parsed.data.title });
    else {
      const result = await db.update(dealDocuments).set({ status: 'sent', updatedAt: new Date() }).where(and(eq(dealDocuments.id, dealId), eq(dealDocuments.workspaceId, context.workspaceId), inArray(dealDocuments.status, ['changes_requested', 'draft']))).returning({ id: dealDocuments.id });
      if (result.length === 0) throw new Error('Nothing to send again');
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not complete that' }, { status: 409 });
  }
}
