import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { verifySameOrigin } from '@/server/http/security';
import { createProjectCompletionDocument } from '@/server/services/deals/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    let uploaded: { buffer: Buffer; filename: string } | undefined;
    if (request.headers.get('content-type')?.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (file instanceof File && file.size > 0) uploaded = { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name };
    }
    const id = await createProjectCompletionDocument(context.workspaceId, (await params).projectId, uploaded);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not prepare the delivery record' }, { status: 409 });
  }
}
