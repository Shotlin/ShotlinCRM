import { and, asc, eq, inArray } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { PDFDocument as LibDocument } from 'pdf-lib';
import { db } from '../../db/client';
import { clients, dealDocuments, documentSignatures, leads, projectMilestones, workspaces } from '../../db/schema';
import { deletePrivateMedia, getPrivateMedia, putPrivateMedia } from '../../storage';
import { SUPPLIER } from '../invoicing/supplier';
import { gstOf } from './milestones';

const FONT_DIR = path.join(process.cwd(), 'src/server/services/invoicing/assets/fonts');
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const IST = 'Asia/Kolkata';
const stamp = (date: Date) =>
  `${new Intl.DateTimeFormat('en-GB', { timeZone: IST, day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(date)} IST`;

export const LOCKED_NOTE = 'This document has been signed and is locked. Start a new version if something has to change.';

// A signed (or client-signed) document may not be edited, replaced or deleted.
export async function isDocumentLocked(documentId: string) {
  const [doc] = await db.select({ status: dealDocuments.status }).from(dealDocuments).where(eq(dealDocuments.id, documentId)).limit(1);
  if (!doc) return false;
  if (doc.status === 'client_signed') return true;
  if (doc.status !== 'signed') return false;
  const rows = await db.select({ id: documentSignatures.id }).from(documentSignatures).where(eq(documentSignatures.documentId, documentId)).limit(1);
  return rows.length > 0;
}

// ---------------------------------------------------------------- the signature picture

const DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;

// Accepts the drawn signature from the browser and returns a clean transparent PNG.
export async function normaliseSignature(dataUrl: string): Promise<Buffer> {
  const match = DATA_URL.exec(dataUrl);
  if (!match) throw new Error('Draw your signature first');
  const raw = Buffer.from(match[1], 'base64');
  if (raw.length < 400) throw new Error('The signature is empty. Please draw it again.');
  if (raw.length > 400 * 1024) throw new Error('The signature picture is too large');
  const { default: sharp } = await import('sharp');
  const image = sharp(raw, { failOn: 'none' });
  const meta = await image.metadata();
  if (meta.format !== 'png') throw new Error('The signature picture is not valid');
  return sharp(raw).trim().resize({ width: 520, height: 200, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
}

// ---------------------------------------------------------------- the acceptance page

export type SignatureEntry = {
  heading: string;
  name: string;
  title: string;
  signedAt: Date;
  ip?: string;
  png: Buffer | null;
};

// One A4 page that records who signed, when, and the fingerprint of the document they agreed to.
export async function renderAcceptancePage(input: { documentTitle: string; reference: string; sha256: string; entry: SignatureEntry; statement: string }): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 54, bottom: 54, left: 54, right: 54 }, info: { Title: `Signature - ${input.documentTitle}`, Author: SUPPLIER.name } });
  doc.registerFont('R', readFileSync(path.join(FONT_DIR, 'arimo-latin-400-normal.woff')));
  doc.registerFont('B', readFileSync(path.join(FONT_DIR, 'arimo-latin-700-normal.woff')));
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - 108;
  doc.font('B').fontSize(9).fillColor('#707070').text('SHOTLIN DIGITAL PRODUCT STUDIO', { characterSpacing: 1.2 });
  doc.moveDown(0.6).font('B').fontSize(20).fillColor('#111827').text(input.entry.heading.toUpperCase());
  doc.moveDown(0.3).font('R').fontSize(11).fillColor('#464646').text(input.documentTitle);
  if (input.reference) doc.fontSize(9.5).fillColor('#707070').text(`Reference: ${input.reference}`);
  doc.moveDown(0.8).moveTo(54, doc.y).lineTo(54 + width, doc.y).lineWidth(0.8).strokeColor('#E2E8F0').stroke();

  doc.moveDown(1).font('R').fontSize(10.5).fillColor('#111827').text(input.statement, { width, lineGap: 3 });

  doc.moveDown(1.4);
  const top = doc.y;
  doc.roundedRect(54, top, width, 150, 6).lineWidth(0.8).strokeColor('#D5D6D1').stroke();
  if (input.entry.png) {
    try {
      doc.image(input.entry.png, 70, top + 14, { fit: [width - 32, 90] });
    } catch {
      // A damaged picture must not stop the page being written.
    }
  }
  doc.moveTo(70, top + 112).lineTo(54 + width - 16, top + 112).lineWidth(0.6).strokeColor('#9CA3AF').stroke();
  doc.font('B').fontSize(11).fillColor('#111827').text(input.entry.name, 70, top + 119, { width: width - 32 });
  if (input.entry.title) doc.font('R').fontSize(9.5).fillColor('#464646').text(input.entry.title, 70, top + 135, { width: width - 32 });

  doc.y = top + 168;
  doc.x = 54;
  const rows: [string, string][] = [
    ['Signed on', stamp(input.entry.signedAt)],
    ...(input.entry.ip ? ([['Signed from IP address', input.entry.ip]] as [string, string][]) : []),
    ['Document fingerprint (SHA-256)', input.sha256],
  ];
  for (const [label, value] of rows) {
    doc.font('B').fontSize(8.5).fillColor('#707070').text(label.toUpperCase(), 54, doc.y, { characterSpacing: 0.6 });
    doc.font('R').fontSize(9.5).fillColor('#111827').text(value, 54, doc.y + 1, { width });
    doc.moveDown(0.7);
  }
  doc.moveDown(0.6).font('R').fontSize(8.5).fillColor('#707070').text(
    'The fingerprint is calculated from the document exactly as the signer saw it. If even one letter of that document changes, the fingerprint no longer matches, so a signed copy cannot be quietly altered.',
    54,
    doc.y,
    { width, lineGap: 2 },
  );
  doc.end();
  return done;
}

// Adds the acceptance page(s) to the end of the document.
export async function appendPages(original: Buffer, extra: Buffer): Promise<Buffer> {
  const target = await LibDocument.load(original, { updateMetadata: false });
  const addition = await LibDocument.load(extra);
  const pages = await target.copyPages(addition, addition.getPageIndices());
  for (const page of pages) target.addPage(page);
  return Buffer.from(await target.save({ useObjectStreams: true }));
}

// ---------------------------------------------------------------- the two signatures

const slug = (value: string) => value.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'Document';

async function swapFile(workspaceId: string, documentId: string, oldKey: string | null, bytes: Buffer, name: string) {
  const stored = await putPrivateMedia({ workspaceId, buffer: bytes, mimeType: 'application/pdf', filename: name, optimize: false });
  return { stored, cleanup: async () => (oldKey ? deletePrivateMedia(oldKey).catch(() => undefined) : undefined), undo: async () => deletePrivateMedia(stored.objectKey).catch(() => undefined), documentId };
}

export type ClientSignatureInput = { name: string; title: string; signatureDataUrl: string; consent: boolean; ip: string; userAgent: string };

export async function submitClientSignature(link: { workspaceId: string; targetId: string }, input: ClientSignatureInput) {
  const name = input.name.trim();
  if (name.length < 2) throw new Error('Type your full name');
  if (!input.consent) throw new Error('Tick the box to confirm you have read and agree to this document');
  const png = await normaliseSignature(input.signatureDataUrl);

  const [doc] = await db.select().from(dealDocuments).where(and(eq(dealDocuments.id, link.targetId), eq(dealDocuments.workspaceId, link.workspaceId))).limit(1);
  if (!doc || !doc.fileKey) throw new Error('This document is not ready to sign');
  if (doc.status !== 'sent' && doc.status !== 'changes_requested') {
    throw new Error(doc.status === 'client_signed' || doc.status === 'signed' ? 'This document has already been signed.' : 'This document cannot be signed right now.');
  }
  const original = await getPrivateMedia(doc.fileKey);
  const fingerprint = sha256(original);
  const signedAt = new Date();
  const page = await renderAcceptancePage({
    documentTitle: doc.title,
    reference: doc.reference,
    sha256: fingerprint,
    entry: { heading: 'Client acceptance', name, title: input.title.trim(), signedAt, ip: input.ip, png },
    statement: `I, ${name}${input.title.trim() ? `, ${input.title.trim()}` : ''}, have read this document in full, understood it, and agree to be bound by it. I confirm I am authorised to sign it on behalf of the client named in it. I adopt the signature drawn below as my own signature.`,
  });
  const merged = await appendPages(original, page);
  const swap = await swapFile(link.workspaceId, doc.id, doc.fileKey, merged, `Signed_${slug(doc.title)}.pdf`);
  const signaturePicture = await putPrivateMedia({ workspaceId: link.workspaceId, buffer: png, mimeType: 'image/png', filename: 'signature.png', optimize: false });

  const updated = await db
    .update(dealDocuments)
    .set({ fileKey: swap.stored.objectKey, fileName: `Signed_${slug(doc.title)}.pdf`, fileSize: swap.stored.sizeBytes, status: 'client_signed', reviewNote: '', updatedAt: new Date() })
    .where(and(eq(dealDocuments.id, doc.id), inArray(dealDocuments.status, ['sent', 'changes_requested'])))
    .returning({ id: dealDocuments.id });
  if (updated.length === 0) {
    // Someone signed at the same moment. Throw away what was just made.
    await swap.undo();
    await deletePrivateMedia(signaturePicture.objectKey).catch(() => undefined);
    throw new Error('This document has already been signed.');
  }
  await db.insert(documentSignatures).values({
    id: `signature-${randomUUID()}`,
    workspaceId: link.workspaceId,
    documentId: doc.id,
    role: 'client',
    signerName: name,
    signerTitle: input.title.trim(),
    signatureKey: signaturePicture.objectKey,
    documentSha256: fingerprint,
    ipAddress: input.ip.slice(0, 80),
    userAgent: input.userAgent.slice(0, 300),
    signedAt,
  });
  // The old, unsigned file is no longer needed: the signed one contains all of it.
  await swap.cleanup();
}

export async function requestChanges(link: { workspaceId: string; targetId: string }, name: string, message: string) {
  if (message.trim().length < 3) throw new Error('Tell us what you would like changed');
  const updated = await db
    .update(dealDocuments)
    .set({ status: 'changes_requested', reviewNote: `${name.trim() || 'The client'}: ${message.trim()}`.slice(0, 2000), updatedAt: new Date() })
    .where(and(eq(dealDocuments.id, link.targetId), eq(dealDocuments.workspaceId, link.workspaceId), eq(dealDocuments.status, 'sent')))
    .returning({ id: dealDocuments.id });
  if (updated.length === 0) throw new Error('This document cannot be changed right now.');
}

export async function saveCompanySignature(workspaceId: string, image: Buffer, name: string, title: string) {
  const { default: sharp } = await import('sharp');
  const png = await sharp(image, { failOn: 'none' }).trim().resize({ width: 520, height: 260, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
  const stored = await putPrivateMedia({ workspaceId, buffer: png, mimeType: 'image/png', filename: 'company-signature.png', optimize: false });
  const [workspace] = await db.select({ key: workspaces.signatureKey }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  await db.update(workspaces).set({ signatureKey: stored.objectKey, signatoryName: name.trim(), signatoryTitle: title.trim() }).where(eq(workspaces.id, workspaceId));
  if (workspace?.key) await deletePrivateMedia(workspace.key).catch(() => undefined);
}

export async function companySignatureStatus(workspaceId: string) {
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return { hasSignature: Boolean(workspace?.signatureKey), name: workspace?.signatoryName ?? '', title: workspace?.signatoryTitle ?? '' };
}

// You review the client-signed copy and approve it. Your signature goes on a second page and the agreement becomes signed.
export async function countersign(workspaceId: string, documentId: string, input: { name: string; title: string }) {
  const [doc] = await db.select().from(dealDocuments).where(and(eq(dealDocuments.id, documentId), eq(dealDocuments.workspaceId, workspaceId))).limit(1);
  if (!doc || !doc.fileKey) throw new Error('Not found');
  if (doc.status !== 'client_signed') throw new Error('Only a document the client has signed can be approved');
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const name = (input.name || workspace?.signatoryName || '').trim();
  if (name.length < 2) throw new Error('Type the name of the person signing for Shotlin');
  const title = (input.title || workspace?.signatoryTitle || '').trim();
  const png = workspace?.signatureKey ? await getPrivateMedia(workspace.signatureKey).catch(() => null) : null;

  const original = await getPrivateMedia(doc.fileKey);
  const fingerprint = sha256(original);
  const signedAt = new Date();
  const page = await renderAcceptancePage({
    documentTitle: doc.title,
    reference: doc.reference,
    sha256: fingerprint,
    entry: { heading: 'Countersigned by Shotlin', name, title, signedAt, png },
    statement: `${SUPPLIER.name} has reviewed the client's signed copy of this document and approves it. This page confirms the agreement is now fully signed by both parties. The fingerprint below is that of the client-signed copy it follows.`,
  });
  const merged = await appendPages(original, page);
  const swap = await swapFile(workspaceId, doc.id, doc.fileKey, merged, `Signed_${slug(doc.title)}.pdf`);
  const updated = await db
    .update(dealDocuments)
    .set({ fileKey: swap.stored.objectKey, fileName: `Signed_${slug(doc.title)}.pdf`, fileSize: swap.stored.sizeBytes, status: 'signed', signedOn: signedAt, updatedAt: new Date() })
    .where(and(eq(dealDocuments.id, doc.id), eq(dealDocuments.status, 'client_signed')))
    .returning({ id: dealDocuments.id });
  if (updated.length === 0) {
    await swap.undo();
    throw new Error('This document was already approved.');
  }
  await db.insert(documentSignatures).values({
    id: `signature-${randomUUID()}`,
    workspaceId,
    documentId: doc.id,
    role: 'developer',
    signerName: name,
    signerTitle: title,
    signatureKey: workspace?.signatureKey ?? null,
    documentSha256: fingerprint,
    signedAt,
  });
  await swap.cleanup();
}

export async function listSignatures(workspaceId: string, documentId: string) {
  const rows = await db.select().from(documentSignatures).where(and(eq(documentSignatures.documentId, documentId), eq(documentSignatures.workspaceId, workspaceId))).orderBy(asc(documentSignatures.signedAt));
  return rows.map((row) => ({
    role: row.role as 'client' | 'developer',
    name: row.signerName,
    title: row.signerTitle,
    signedAt: row.signedAt.toISOString(),
    ip: row.ipAddress,
    sha256: row.documentSha256,
  }));
}

// What the client sees when they open the signing link.
export async function loadSigningView(workspaceId: string, documentId: string) {
  const [row] = await db
    .select({ doc: dealDocuments, client: clients.company, clientName: clients.name, lead: leads.name })
    .from(dealDocuments)
    .leftJoin(clients, eq(clients.id, dealDocuments.clientId))
    .leftJoin(leads, eq(leads.id, dealDocuments.leadId))
    .where(and(eq(dealDocuments.id, documentId), eq(dealDocuments.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return null;
  const { doc } = row;
  const ms = await db.select().from(projectMilestones).where(eq(projectMilestones.documentId, documentId)).orderBy(asc(projectMilestones.position));
  const signatures = await listSignatures(workspaceId, documentId);
  return {
    title: doc.title,
    kind: doc.kind as 'proposal' | 'agreement',
    reference: doc.reference,
    status: doc.status,
    party: row.client || row.clientName || row.lead || '',
    baseMinor: doc.baseAmountMinor,
    gstMinor: gstOf(doc.baseAmountMinor, doc.gstRatePct),
    gstRatePct: doc.gstRatePct,
    hasFile: Boolean(doc.fileKey),
    reviewNote: doc.reviewNote,
    milestones: ms.map((m) => ({ title: m.title, trigger: m.trigger, grossMinor: m.baseMinor + gstOf(m.baseMinor, doc.gstRatePct) })),
    clientSignature: signatures.find((s) => s.role === 'client') ?? null,
    countersigned: signatures.some((s) => s.role === 'developer'),
  };
}
