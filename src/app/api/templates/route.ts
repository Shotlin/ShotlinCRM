import { and, desc, eq, isNull } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/server/auth/config';
import { db } from '@/server/db/client';
import { messageTemplates } from '@/server/db/schema';
import { verifySameOrigin } from '@/server/http/security';
import { validateTemplate } from '@/server/services/templates/render';

export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await db
    .select()
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.workspaceId, context.workspaceId),
        isNull(messageTemplates.archivedAt),
      ),
    )
    .orderBy(desc(messageTemplates.updatedAt));
  return NextResponse.json({ templates: rows }, { headers: { 'Cache-Control': 'no-store' } });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(8_000),
});

export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Add a template name and message' }, { status: 400 });
  try {
    validateTemplate(parsed.data.body);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid template' },
      { status: 400 },
    );
  }
  const [template] = await db
    .insert(messageTemplates)
    .values({
      id: crypto.randomUUID(),
      workspaceId: context.workspaceId,
      name: parsed.data.name,
      body: parsed.data.body,
    })
    .returning();
  return NextResponse.json({ template }, { status: 201 });
}
