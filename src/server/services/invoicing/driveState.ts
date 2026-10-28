import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { invoices } from '../../db/schema';

export const driveConfigured = () => Boolean(process.env.DRIVE_SCRIPT_URL && process.env.DRIVE_SCRIPT_TOKEN);

// Flags an invoice so the worker re-syncs it to Drive. A single worker does the syncing, which
// keeps writes to the master workbook one at a time.
export async function markDriveDirty(workspaceId: string, invoiceId: string) {
  if (!driveConfigured()) return;
  await db
    .update(invoices)
    .set({
      driveFiles: sql`coalesce(${invoices.driveFiles}, '{}'::jsonb) || jsonb_build_object('state', 'pending', 'attempts', 0, 'error', null, 'nextAttemptAt', null, 'rev', coalesce((${invoices.driveFiles}->>'rev')::int, 0) + 1)`,
    })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.workspaceId, workspaceId), isNotNull(invoices.docType)));
}
