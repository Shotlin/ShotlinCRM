import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { getAuthContext } from '@/server/auth/config';
import { db } from '@/server/db/client';
import { invoices } from '@/server/db/schema';

export const dynamic = 'force-dynamic';

// The billing details of a client's most recent GST invoice, so a new one starts filled in.
export async function GET(request: NextRequest) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const clientId = request.nextUrl.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ customer: null });
  const [row] = await db
    .select({ customer: invoices.customer })
    .from(invoices)
    .where(and(eq(invoices.workspaceId, context.workspaceId), eq(invoices.clientId, clientId), isNotNull(invoices.docType)))
    .orderBy(desc(invoices.issuedAt))
    .limit(1);
  return NextResponse.json({ customer: row?.customer ?? null }, { headers: { 'Cache-Control': 'no-store' } });
}
