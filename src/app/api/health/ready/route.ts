import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { getPublisher } from '@/server/realtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await Promise.all([db.execute(sql`select 1`), getPublisher().ping()]);
    return NextResponse.json({ ok: true, database: 'ready', redis: 'ready' });
  } catch {
    return NextResponse.json({ ok: false, database: 'unavailable', redis: 'unavailable' }, { status: 503 });
  }
}
