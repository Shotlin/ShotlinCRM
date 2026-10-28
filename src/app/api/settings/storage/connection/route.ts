import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { rateLimit } from '@/server/http/rate-limit';
import { verifySameOrigin } from '@/server/http/security';
import { publishChange } from '@/server/realtime';
import { connectionInputSchema, connectionStatus, saveConnection, testBucket, toBucketConfig } from '@/server/storage/connection';

export const dynamic = 'force-dynamic';

// Request bodies hold secret keys, so nothing here ever logs or echoes them.
export async function GET() {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await connectionStatus(context.workspaceId), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (context.role !== 'owner') return NextResponse.json({ error: 'Only an owner can change storage.' }, { status: 403 });
  if (!(await rateLimit(`storage-connect:${context.workspaceId}`, 10, 60))) {
    return NextResponse.json({ error: 'Too many attempts. Wait a minute.' }, { status: 429 });
  }

  const parsed = connectionInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Check the details.' }, { status: 400 });
  }
  // It must pass the same test as the Test button before anything is saved.
  const test = await testBucket(toBucketConfig(parsed.data));
  if (!test.ok) return NextResponse.json({ error: test.steps.find((step) => !step.ok)?.message ?? 'The test did not pass.', steps: test.steps }, { status: 422 });

  await saveConnection(context.workspaceId, parsed.data);
  await publishChange(context.workspaceId, 'storage.connecting');
  return NextResponse.json(await connectionStatus(context.workspaceId), { status: 202 });
}
