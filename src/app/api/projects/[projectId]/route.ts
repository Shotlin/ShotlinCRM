import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { verifySameOrigin } from '@/server/http/security';
import { getProjectDetail, projectPatchSchema, updateProject } from '@/server/services/deals/store';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ projectId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const detail = await getProjectDetail(context.workspaceId, (await params).projectId);
  return detail ? NextResponse.json(detail, { headers: { 'Cache-Control': 'no-store' } }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = projectPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Check the details.' }, { status: 400 });
  try {
    await updateProject(context.workspaceId, (await params).projectId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
}
