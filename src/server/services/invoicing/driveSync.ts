import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { invoices, payments } from '../../db/schema';
import { quarterFolderName } from './calc';
import { renderInvoiceDocx } from './docx';
import { chooseDestination, ledgerRow, pendingPromotion, pendingRow, seriesRow, type RowRequest } from './driveMap';
import { driveConfigured } from './driveState';
import { invoiceFileName, loadGstInvoice } from './issue';
import { renderInvoicePdf } from './pdf';

const MAX_ATTEMPTS = 8;
const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type SavedFiles = { folderId: string; folderName: string; files: { kind: 'pdf' | 'docx'; id: string; url: string }[] };

// Calls the Apps Script web app. It always answers with {ok, result | error}.
export async function callDrive<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const url = process.env.DRIVE_SCRIPT_URL;
  const token = process.env.DRIVE_SCRIPT_TOKEN;
  if (!url || !token) throw new Error('The Drive link is not set up (DRIVE_SCRIPT_URL / DRIVE_SCRIPT_TOKEN).');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, action, ...payload }),
    redirect: 'follow',
    signal: AbortSignal.timeout(110_000),
  });
  const text = await response.text();
  let parsed: { ok?: boolean; result?: T; error?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`The Drive script gave an unexpected answer (HTTP ${response.status}).`);
  }
  if (!parsed.ok) throw new Error(parsed.error ?? 'The Drive script reported an error.');
  return parsed.result as T;
}

const upsert = (sheet: string, key: string, request: RowRequest, extra: Record<string, unknown> = {}) =>
  callDrive('upsertRow', { sheet, key, ...request, ...extra });

async function patchDriveFiles(invoiceId: string, patch: Record<string, unknown>, onlyAtRev?: number) {
  const revision = onlyAtRev === undefined ? sql`` : sql` and coalesce((${invoices.driveFiles}->>'rev')::int, 0) = ${onlyAtRev}`;
  const result = await db.execute(sql`
    update ${invoices}
    set drive_files = coalesce(${invoices.driveFiles}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
    where ${invoices.id} = ${invoiceId}${revision}
  `);
  return result.rowCount ?? 0;
}

// Brings one invoice's Drive files and workbook rows in line with the CRM. Safe to run again:
// every write is keyed by document number or payment id, so nothing is ever duplicated.
export async function syncInvoice(workspaceId: string, invoiceId: string) {
  const loaded = await loadGstInvoice(workspaceId, invoiceId);
  const [row] = await db
    .select({ driveFiles: invoices.driveFiles, cancelReason: invoices.cancelReason })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.workspaceId, workspaceId)))
    .limit(1);
  const meta = row?.driveFiles ?? {};
  const revision = Number((meta as { rev?: number }).rev ?? 0);
  const paid = await db
    .select()
    .from(payments)
    .where(and(eq(payments.invoiceId, invoiceId), eq(payments.workspaceId, workspaceId)))
    .orderBy(asc(payments.receivedAt));

  const { model, totals } = loaded;
  const destination = chooseDestination({
    status: loaded.status,
    docType: model.docType,
    cancelled: loaded.cancelled,
    receivedMinor: loaded.receivedMinor,
    grandMinor: totals.grandMinor,
    advanceRule: process.env.DRIVE_ADVANCE_RULE,
  });

  const prefix = loaded.cancelled ? 'CANCELLED_' : '';
  const pdfName = `${prefix}${invoiceFileName(model, 'pdf')}`;
  const docxName = `${prefix}${invoiceFileName(model, 'docx')}`;
  const [pdfBytes, docxBytes] = await Promise.all([renderInvoicePdf(model), renderInvoiceDocx(model)]);

  const saved = await callDrive<SavedFiles>('saveFiles', {
    docNo: loaded.docNo,
    destination,
    quarterFolderName: quarterFolderName(model.issuedAt),
    files: [
      { kind: 'pdf', name: pdfName, mimeType: PDF_MIME, base64: pdfBytes.toString('base64') },
      { kind: 'docx', name: docxName, mimeType: DOCX_MIME, base64: docxBytes.toString('base64') },
    ],
    replaceIds: [meta.pdfId, meta.docxId].filter((id): id is string => Boolean(id)),
  });
  const pdf = saved.files.find((file) => file.kind === 'pdf');
  const docx = saved.files.find((file) => file.kind === 'docx');
  if (!pdf || !docx) throw new Error('The Drive script did not return both files.');
  // Remember the new files straight away, so a failure further down never loses track of them.
  await patchDriveFiles(invoiceId, {
    pdfId: pdf.id,
    docxId: docx.id,
    pdfUrl: pdf.url,
    docxUrl: docx.url,
    destination,
    folderName: saved.folderName,
  });

  const context = {
    model,
    totals,
    docNo: loaded.docNo,
    receivedMinor: loaded.receivedMinor,
    cancelled: loaded.cancelled,
    cancelReason: row?.cancelReason,
    pdf: { name: pdfName, url: pdf.url },
  };
  if (destination === 'pending') {
    await upsert('GST_Pending', loaded.docNo, pendingRow(context));
  } else {
    await upsert('GST_Series', loaded.docNo, seriesRow(context));
    await upsert('GST_Pending', loaded.docNo, pendingPromotion(context), { onlyIfExists: true });
  }
  for (const payment of paid) {
    await upsert('Pay_Ledger', payment.id, ledgerRow(context, payment));
  }

  // If the invoice changed again while this ran, it stays pending and the next sweep picks it up.
  await patchDriveFiles(
    invoiceId,
    { state: 'synced', syncedAt: new Date().toISOString(), error: null, attempts: 0, nextAttemptAt: null },
    revision,
  );
  return { destination, pdfUrl: pdf.url, docxUrl: docx.url };
}

async function recordFailure(invoiceId: string, error: unknown) {
  const [row] = await db.select({ driveFiles: invoices.driveFiles }).from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  const attempts = Number(row?.driveFiles?.attempts ?? 0) + 1;
  const waitSeconds = Math.min(30 * 2 ** attempts, 1800);
  await patchDriveFiles(invoiceId, {
    state: 'failed',
    attempts,
    error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    nextAttemptAt: new Date(Date.now() + waitSeconds * 1000).toISOString(),
  });
}

export async function syncInvoiceSafely(workspaceId: string, invoiceId: string) {
  try {
    await syncInvoice(workspaceId, invoiceId);
    return true;
  } catch (error) {
    await recordFailure(invoiceId, error).catch(() => undefined);
    console.error('Drive sync failed', { invoiceId, message: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

let sweeping = false;

// Run by the worker every few seconds. One invoice at a time, so the workbook is only ever
// written by one thing at once.
export async function sweepDriveSync(limit = 5) {
  if (!driveConfigured() || sweeping) return 0;
  sweeping = true;
  try {
    const due = await db
      .select({ id: invoices.id, workspaceId: invoices.workspaceId })
      .from(invoices)
      .where(
        sql`${invoices.docType} is not null
          and ${invoices.driveFiles}->>'state' in ('pending', 'failed')
          and coalesce((${invoices.driveFiles}->>'attempts')::int, 0) < ${MAX_ATTEMPTS}
          and coalesce((${invoices.driveFiles}->>'nextAttemptAt')::timestamptz, now()) <= now()`,
      )
      .orderBy(asc(invoices.createdAt))
      .limit(limit);
    for (const invoice of due) await syncInvoiceSafely(invoice.workspaceId, invoice.id);
    return due.length;
  } finally {
    sweeping = false;
  }
}
