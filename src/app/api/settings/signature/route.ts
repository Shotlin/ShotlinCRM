import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { verifySameOrigin } from '@/server/http/security';
import { companySignatureStatus, saveCompanySignature } from '@/server/services/deals/signing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await companySignatureStatus(context.workspaceId), { headers: { 'Cache-Control': 'no-store' } });
}

// The company signature or seal, used when you approve a client-signed agreement.
export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (context.role !== 'owner') return NextResponse.json({ error: 'Only an owner can change the company signature.' }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const name = String(form?.get('name') ?? '').trim();
  if (!(file instanceof File) || file.size === 0 || file.size > 2 * 1024 * 1024) return NextResponse.json({ error: 'Choose a PNG or JPG picture under 2 MB' }, { status: 400 });
  if (name.length < 2) return NextResponse.json({ error: 'Type the signatory name' }, { status: 400 });
  try {
    await saveCompanySignature(context.workspaceId, Buffer.from(await file.arrayBuffer()), name, String(form?.get('title') ?? ''));
    return NextResponse.json(await companySignatureStatus(context.workspaceId));
  } catch {
    return NextResponse.json({ error: 'That picture could not be read. Try a PNG or JPG.' }, { status: 400 });
  }
}
