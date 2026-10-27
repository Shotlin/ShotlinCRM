import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { rateLimit } from '@/server/http/rate-limit';
import { verifySameOrigin } from '@/server/http/security';
import { generateContactBrief } from '@/server/services/ai/analysis';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await rateLimit(`ai-brief:${context.workspaceId}`, 6, 60))) {
    return NextResponse.json({ error: 'Too many analysis requests' }, { status: 429 });
  }
  const { leadId } = await params;
  try {
    const brief = await generateContactBrief(context.workspaceId, leadId);
    return NextResponse.json({ brief });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Contact analysis could not be generated' },
      { status: 409 },
    );
  }
}
