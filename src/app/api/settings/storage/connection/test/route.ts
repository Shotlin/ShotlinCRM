import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { rateLimit } from '@/server/http/rate-limit';
import { verifySameOrigin } from '@/server/http/security';
import { connectionInputSchema, testBucket, toBucketConfig } from '@/server/storage/connection';

// Tries the details without saving anything. The keys in the request are never logged or echoed.
export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (context.role !== 'owner') return NextResponse.json({ error: 'Only an owner can change storage.' }, { status: 403 });
  if (!(await rateLimit(`storage-test:${context.workspaceId}`, 10, 60))) {
    return NextResponse.json({ error: 'Too many attempts. Wait a minute.' }, { status: 429 });
  }
  const parsed = connectionInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Check the details.' }, { status: 400 });
  }
  return NextResponse.json(await testBucket(toBucketConfig(parsed.data)));
}
