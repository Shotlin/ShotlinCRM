import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { getStorageHealth } from '@/server/services/system/storageHealth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const health = await getStorageHealth({ force: request.nextUrl.searchParams.get('refresh') === '1' });
    return NextResponse.json(health, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Storage check failed', error);
    return NextResponse.json({ error: 'The storage check could not run.' }, { status: 503 });
  }
}
