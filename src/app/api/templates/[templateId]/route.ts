import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/server/auth/config';
import { db } from '@/server/db/client';
import { messageTemplates } from '@/server/db/schema';
import { verifySameOrigin } from '@/server/http/security';
import { validateTemplate } from '@/server/services/templates/render';

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  body: z.string().trim().min(1).max(8_000).optional(),
  archived: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { templateId } = await params;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid template update' }, { status: 400 });
  if (parsed.data.body) {
    try {
      validateTemplate(parsed.data.body);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid template' },
        { status: 400 },
      );
    }
  }
  const [updated] = await db
    .update(messageTemplates)
    .set({
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.body ? { body: parsed.data.body } : {}),
      ...(parsed.data.archived !== undefined
        ? { archivedAt: parsed.data.archived ? new Date() : null }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(messageTemplates.id, templateId),
        eq(messageTemplates.workspaceId, context.workspaceId),
      ),
    )
    .returning();
  if (!updated) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  return NextResponse.json({ template: updated });
}
