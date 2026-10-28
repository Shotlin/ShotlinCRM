import { getObjectFromBucket, headObjectInBucket, isMissing, putObjectToBucket, resolveStorage } from '../../storage';
import { renderInvoiceDocx } from './docx';
import { invoiceFileName, type loadGstInvoice } from './issue';
import { renderInvoicePdf } from './pdf';

type Loaded = Awaited<ReturnType<typeof loadGstInvoice>>;
export type FileFormat = 'pdf' | 'docx';

const MIME: Record<FileFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// A tax invoice is frozen once it is issued. An advance receipt is frozen once it is fully paid,
// because until then it is still being written. Drafts and cancelled invoices are never frozen.
export function isFreezable(invoice: Pick<Loaded, 'status' | 'cancelled' | 'receivedMinor'> & { model: { docType: string }; totals: { grandMinor: number } }) {
  if (invoice.cancelled || invoice.status === 'draft') return false;
  if (invoice.model.docType === 'advance') return invoice.receivedMinor >= invoice.totals.grandMinor;
  return true;
}

export const frozenKey = (workspaceId: string, docNo: string, fileName: string) =>
  `${workspaceId}/invoices/${docNo.replace(/[^A-Za-z0-9._-]+/g, '-')}/${fileName}`;

// The master copy of an invoice file. Once frozen it is read back from R2 exactly as issued and never
// drawn again, so later payments cannot change what the customer was sent. Without R2 it is drawn live.
export async function invoiceFileBytes(workspaceId: string, invoice: Loaded, format: FileFormat): Promise<Buffer> {
  const render = () => (format === 'pdf' ? renderInvoicePdf(invoice.model) : renderInvoiceDocx(invoice.model));
  // Drafts and cancelled invoices are always drawn fresh. Anything issued may already have a master in R2,
  // for example an invoice brought over from before the CRM, and that master wins.
  if (invoice.cancelled || invoice.status === 'draft') return render();
  const storage = await resolveStorage(workspaceId);
  if (storage.mode !== 's3') return render();

  const key = frozenKey(workspaceId, invoice.docNo, invoiceFileName(invoice.model, format));
  if (await headObjectInBucket(storage.config, key)) {
    try {
      return await getObjectFromBucket(storage.config, key);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  const bytes = await render();
  if (isFreezable(invoice)) {
    await putObjectToBucket(storage.config, key, bytes, MIME[format], { frozen: 'true', docNo: invoice.docNo });
  }
  return bytes;
}

// When an issued invoice is amended, the master copies in R2 are filed away as that revision and removed from
// the live place, so the next download draws and freezes the amended invoice. Nothing is deleted outright.
export async function archiveFrozenMasters(workspaceId: string, before: Loaded, revision: number) {
  const storage = await resolveStorage(workspaceId);
  if (storage.mode !== 's3') return;
  for (const format of ['pdf', 'docx'] as const) {
    const name = invoiceFileName(before.model, format);
    const key = frozenKey(workspaceId, before.docNo, name);
    if (!(await headObjectInBucket(storage.config, key))) continue;
    const bytes = await getObjectFromBucket(storage.config, key);
    const archive = frozenKey(workspaceId, `superseded-${before.docNo}`, `rev-${revision}-${name}`);
    await putObjectToBucket(storage.config, archive, bytes, MIME[format], { superseded: 'true', docNo: before.docNo });
    if ((await headObjectInBucket(storage.config, archive))?.sizeBytes === bytes.length) {
      const { deleteObjectFromBucket } = await import('../../storage');
      await deleteObjectFromBucket(storage.config, key);
    }
  }
}
