import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { loadGstReport } from '@/server/services/gst/load';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await loadGstReport(context.workspaceId, request.nextUrl.searchParams.get('fy') ?? undefined), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('GST report failed', error);
    return NextResponse.json({ error: 'The GST report could not be built.' }, { status: 500 });
  }
}
