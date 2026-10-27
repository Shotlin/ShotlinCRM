import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/server/auth/config';
import { rateLimit } from '@/server/http/rate-limit';
import { verifySameOrigin } from '@/server/http/security';
import { sendManualMessage } from '@/server/services/messages/send';

const schema = z.object({
  leadId: z.string().min(1).max(200),
  body: z.string().max(8_000).optional(),
  templateId: z.string().min(1).max(200).optional(),
  mediaId: z.string().min(1).max(200).optional(),
  clientIdempotencyKey: z.string().min(8).max(200),
});

export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await rateLimit(`send:${context.workspaceId}`, 30, 60))) {
    return NextResponse.json({ error: 'Too many messages. Wait a moment before sending again.' }, { status: 429 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid message' }, { status: 400 });

  try {
    const result = await sendManualMessage({ workspaceId: context.workspaceId, ...parsed.data });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Message could not be sent' },
      { status: 409 },
    );
  }
}
