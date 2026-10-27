import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/server/auth/config';
import { rateLimit } from '@/server/http/rate-limit';
import { verifySameOrigin } from '@/server/http/security';
import { testAiProvider } from '@/server/services/ai/settings';

const schema = z.object({
  provider: z.enum(['anthropic', 'openai', 'openrouter']).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  apiKey: z.string().trim().min(10).max(500).optional(),
});

export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (context.role !== 'owner') {
    return NextResponse.json({ error: 'Only the workspace owner can test AI provider settings' }, { status: 403 });
  }
  if (!(await rateLimit(`ai-test:${context.workspaceId}`, 5, 60))) {
    return NextResponse.json({ error: 'Too many connection tests' }, { status: 429 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid test request' }, { status: 400 });
  try {
    const result = await testAiProvider(context.workspaceId, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Provider test failed' },
      { status: 409 },
    );
  }
}
