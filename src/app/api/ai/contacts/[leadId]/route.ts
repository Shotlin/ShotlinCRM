import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { loadAiContact } from '@/server/services/ai/dashboard';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { leadId } = await params;
  try {
    const contact = await loadAiContact(context.workspaceId, leadId);
    return NextResponse.json(contact, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Contact analysis could not be loaded' },
      { status: 404 },
    );
  }
}
