import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/server/auth/config';
import { verifySameOrigin } from '@/server/http/security';
import { getAiSettingsView, saveAiSettings } from '@/server/services/ai/settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (context.role !== 'owner') {
    return NextResponse.json({ error: 'Only the workspace owner can view AI settings' }, { status: 403 });
  }
  const settings = await getAiSettingsView(context.workspaceId);
  return NextResponse.json(settings, { headers: { 'Cache-Control': 'no-store' } });
}

const schema = z.object({
  provider: z.enum(['anthropic', 'openai', 'openrouter']),
  model: z.string().trim().min(1).max(120),
  apiKey: z.string().trim().min(10).max(500).optional(),
  enabled: z.boolean(),
  autoDraftEnabled: z.boolean(),
  redactIdentifiers: z.boolean(),
  firstResponseMinutes: z.number().int().min(5).max(10_080),
  monthlyTokenBudget: z.number().int().min(10_000).max(100_000_000),
});

export async function PUT(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (context.role !== 'owner') {
    return NextResponse.json({ error: 'Only the workspace owner can change AI settings' }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the provider settings and try again' }, { status: 400 });
  }
  try {
    const settings = await saveAiSettings(context.workspaceId, parsed.data);
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'AI settings could not be saved' },
      { status: 409 },
    );
  }
}
