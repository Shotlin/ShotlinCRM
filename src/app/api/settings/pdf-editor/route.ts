import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';

export const dynamic = 'force-dynamic';

// Where the self-hosted PDF text editor lives, if it has been switched on.
export async function GET() {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = process.env.PDF_EDITOR_URL?.trim().replace(/\/$/, '') || null;
  return NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store' } });
}
