import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { verifySameOrigin } from '@/server/http/security';
import { saveSignFields, signFieldsSchema } from '@/server/services/deals/store';

export const dynamic = 'force-dynamic';

// Saves where the signatures are placed on the PDF.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = signFieldsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Check the signature boxes.' }, { status: 400 });
  try {
    await saveSignFields(context.workspaceId, (await params).dealId, parsed.data.fields);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save' }, { status: 409 });
  }
}
