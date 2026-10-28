import { and, desc, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { db } from '@/server/db/client';
import { invoiceRevisions } from '@/server/db/schema';

export const dynamic = 'force-dynamic';

// What an issued invoice said before each amendment.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { invoiceId } = await params;
  const rows = await db
    .select()
    .from(invoiceRevisions)
    .where(and(eq(invoiceRevisions.invoiceId, invoiceId), eq(invoiceRevisions.workspaceId, context.workspaceId)))
    .orderBy(desc(invoiceRevisions.revision));
  return NextResponse.json(
    { revisions: rows.map((row) => ({ revision: row.revision, reason: row.reason, previousNumber: row.previousNumber, previousGrandMinor: row.previousGrandMinor, at: row.createdAt.toISOString() })) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
