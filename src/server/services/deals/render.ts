import { and, asc, eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { db } from '../../db/client';
import { clients, dealDocuments, leads, projectMilestones } from '../../db/schema';
import { SUPPLIER } from '../invoicing/supplier';
import type { Block } from './content';
import { gstOf } from './milestones';

const FONT_DIR = path.join(process.cwd(), 'src/server/services/invoicing/assets/fonts');
const ACCENT = '#4F3BD6';
const NAVY = '#14142B';
const INK = '#111827';
const GREY = '#464646';
const MUTED = '#707070';
const LINE = '#D9D9E3';
const LEFT = 54;

const rs = (minor: number) => `Rs. ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: minor % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(minor / 100)}`;
const longDate = (date: Date | null) => (date ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'long', year: 'numeric' }).format(date) : '');

export type RenderInput = {
  kind: 'proposal' | 'agreement';
  title: string;
  reference: string;
  issuedOn: Date | null;
  durationDays: number | null;
  baseMinor: number;
  gstRatePct: number;
  brief: string;
  party: { name: string; lines: string[] };
  milestones: { title: string; trigger: string; baseMinor: number }[];
  blocks: Block[];
};

export async function renderDealPdf(input: RenderInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 64, left: LEFT, right: LEFT }, bufferPages: true, info: { Title: input.title, Author: SUPPLIER.name } });
  doc.registerFont('R', readFileSync(path.join(FONT_DIR, 'arimo-latin-400-normal.woff')));
  doc.registerFont('B', readFileSync(path.join(FONT_DIR, 'arimo-latin-700-normal.woff')));
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const width = doc.page.width - LEFT * 2;
  const bottom = () => doc.page.height - 64;
  const ensure = (height: number) => {
    if (doc.y + height > bottom()) doc.addPage();
  };

  // ---- cover
  const gross = input.baseMinor + gstOf(input.baseMinor, input.gstRatePct);
  doc.font('B').fontSize(30).fillColor(NAVY).text('SHOTLIN', { align: 'center', characterSpacing: 2 });
  doc.font('B').fontSize(10).fillColor(ACCENT).text('DIGITAL PRODUCT STUDIO', { align: 'center', characterSpacing: 1.5 });
  doc.moveDown(1.6).font('B').fontSize(19).fillColor(NAVY).text(input.kind === 'agreement' ? 'PROJECT DEVELOPMENT AGREEMENT' : 'CLIENT PROPOSAL', { align: 'center' });
  doc.moveDown(0.4).font('B').fontSize(13).fillColor(ACCENT).text(input.title, { align: 'center' });
  if (input.reference) doc.moveDown(0.3).font('R').fontSize(9.5).fillColor(MUTED).text(input.reference, { align: 'center' });
  doc.moveDown(1.4);

  // parties
  const colWidth = width / 2;
  const top = doc.y;
  doc.rect(LEFT, top, width, 22).fill(NAVY);
  doc.font('B').fontSize(9).fillColor('#FFFFFF').text('DEVELOPER', LEFT, top + 7, { width: colWidth, align: 'center' }).text(input.kind === 'agreement' ? 'CLIENT' : 'PREPARED FOR', LEFT + colWidth, top + 7, { width: colWidth, align: 'center' });
  const dev = [SUPPLIER.name, `GSTIN: ${SUPPLIER.gstin}`, ...SUPPLIER.addressLines];
  doc.font('R').fontSize(9.5);
  const leftH = doc.heightOfString(dev.join('\n'), { width: colWidth - 20 });
  const rightH = doc.heightOfString([input.party.name, ...input.party.lines].join('\n'), { width: colWidth - 20 });
  const boxH = Math.max(leftH, rightH) + 20;
  doc.rect(LEFT, top + 22, width, boxH).lineWidth(0.8).strokeColor(LINE).stroke();
  doc.moveTo(LEFT + colWidth, top + 22).lineTo(LEFT + colWidth, top + 22 + boxH).stroke();
  doc.font('B').fillColor(INK).text(dev[0], LEFT + 10, top + 32, { width: colWidth - 20 });
  doc.font('R').fillColor(GREY).text(dev.slice(1).join('\n'), LEFT + 10, doc.y + 2, { width: colWidth - 20 });
  doc.font('B').fillColor(INK).text(input.party.name, LEFT + colWidth + 10, top + 32, { width: colWidth - 20 });
  doc.font('R').fillColor(GREY).text(input.party.lines.join('\n'), LEFT + colWidth + 10, doc.y + 2, { width: colWidth - 20 });
  doc.y = top + 22 + boxH + 16;
  doc.x = LEFT;

  const facts = [
    input.issuedOn ? `${input.kind === 'agreement' ? 'Agreement' : 'Proposal'} date: ${longDate(input.issuedOn)}` : '',
    input.durationDays ? `Delivery: ${input.durationDays} days from kickoff` : '',
    input.baseMinor > 0 ? `Project fee: ${rs(input.baseMinor)} + ${input.gstRatePct}% GST ${rs(gstOf(input.baseMinor, input.gstRatePct))} = ${rs(gross)}` : '',
  ].filter(Boolean);
  doc.font('R').fontSize(10).fillColor(INK);
  for (const fact of facts) doc.text(fact, LEFT, doc.y, { width, lineGap: 2 });
  if (input.brief.trim()) {
    doc.moveDown(0.8);
    const y = doc.y;
    const h = doc.heightOfString(input.brief, { width: width - 24 }) + 22;
    doc.rect(LEFT, y, width, h).lineWidth(1).strokeColor(ACCENT).stroke();
    doc.font('B').fontSize(9).fillColor(ACCENT).text('PROJECT SUMMARY', LEFT + 12, y + 8);
    doc.font('R').fontSize(9.5).fillColor(INK).text(input.brief, LEFT + 12, y + 20, { width: width - 24 });
    doc.y = y + h + 6;
  }
  doc.addPage();

  // ---- the written body
  let numbered = 0;
  for (const block of input.blocks) {
    const text = block.text.trim();
    if (block.type === 'pagebreak') {
      doc.addPage();
      continue;
    }
    if (!text) continue;
    if (block.type === 'h1') {
      ensure(48);
      doc.moveDown(0.6).font('B').fontSize(13).fillColor(ACCENT).text(text, LEFT, doc.y, { width });
      doc.moveDown(0.3);
      numbered = 0;
    } else if (block.type === 'h2') {
      ensure(36);
      doc.moveDown(0.4).font('B').fontSize(10.5).fillColor(NAVY).text(text, LEFT, doc.y, { width });
      doc.moveDown(0.2);
    } else if (block.type === 'p') {
      doc.font('R').fontSize(10).fillColor(INK).text(text, LEFT, doc.y, { width, lineGap: 3, align: 'left' });
      doc.moveDown(0.5);
    } else if (block.type === 'bullets' || block.type === 'numbered') {
      for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
        ensure(24);
        const marker = block.type === 'bullets' ? '•' : `${++numbered}.`;
        const y = doc.y;
        doc.font('R').fontSize(10).fillColor(INK).text(marker, LEFT + 4, y, { width: 22 });
        doc.text(line, LEFT + 26, y, { width: width - 26, lineGap: 2.5 });
        doc.moveDown(0.25);
      }
      doc.moveDown(0.3);
      if (block.type === 'numbered') numbered = 0;
    } else if (block.type === 'table') {
      const rows = text.split('\n').map((line) => line.split('|').map((cell) => cell.trim())).filter((r) => r.some(Boolean));
      const cols = Math.max(...rows.map((r) => r.length));
      const cw = width / cols;
      rows.forEach((row, rowIndex) => {
        doc.font(rowIndex === 0 ? 'B' : 'R').fontSize(9);
        const h = Math.max(...Array.from({ length: cols }, (_, c) => doc.heightOfString(row[c] ?? '', { width: cw - 14 }))) + 14;
        ensure(h + 2);
        const y = doc.y;
        if (rowIndex === 0) doc.rect(LEFT, y, width, h).fill(NAVY);
        else doc.rect(LEFT, y, width, h).lineWidth(0.6).strokeColor(LINE).stroke();
        for (let c = 0; c < cols; c += 1) {
          doc.font(rowIndex === 0 ? 'B' : 'R').fontSize(9).fillColor(rowIndex === 0 ? '#FFFFFF' : INK).text(row[c] ?? '', LEFT + c * cw + 7, y + 7, { width: cw - 14 });
        }
        doc.y = y + h;
      });
      doc.moveDown(0.8);
    }
  }

  // ---- commercial value and the payment schedule, always from the milestones above
  if (input.milestones.length > 0) {
    ensure(150);
    doc.moveDown(0.6).font('B').fontSize(13).fillColor(ACCENT).text('Commercial value and payment milestones', LEFT, doc.y, { width });
    doc.moveDown(0.4).font('R').fontSize(10).fillColor(INK).text(`Project value ${rs(input.baseMinor)} + GST @ ${input.gstRatePct}% ${rs(gstOf(input.baseMinor, input.gstRatePct))} = Total payable ${rs(gross)}.`, LEFT, doc.y, { width });
    doc.moveDown(0.5);
    const cw = [width * 0.36, width * 0.1, width * 0.18, width * 0.16, width * 0.2];
    const header = ['Milestone', 'Share', 'Base amount', `GST @ ${input.gstRatePct}%`, 'Gross payable'];
    const draw = (cells: string[], head: boolean, h: number, note = '') => {
      const y = doc.y;
      if (head) doc.rect(LEFT, y, width, h).fill(NAVY);
      else doc.rect(LEFT, y, width, h).lineWidth(0.6).strokeColor(LINE).stroke();
      let x = LEFT;
      cells.forEach((cell, i) => {
        doc.font(head || i === 0 ? 'B' : 'R').fontSize(9).fillColor(head ? '#FFFFFF' : INK).text(cell, x + 7, y + 8, { width: cw[i] - 14 });
        if (i === 0 && note) doc.font('R').fontSize(8).fillColor(MUTED).text(note, x + 7, doc.y + 2, { width: cw[i] - 14 });
        x += cw[i];
      });
      doc.y = y + h;
    };
    draw(header, true, 24);
    for (const m of input.milestones) {
      doc.font('B').fontSize(9);
      const titleH = doc.heightOfString(m.title, { width: cw[0] - 14 });
      doc.font('R').fontSize(8);
      const noteH = m.trigger ? doc.heightOfString(m.trigger, { width: cw[0] - 14 }) + 2 : 0;
      const h = titleH + noteH + 18;
      ensure(h + 2);
      const share = input.baseMinor > 0 ? `${(Math.round((m.baseMinor / input.baseMinor) * 10000) / 100).toString()}%` : '';
      draw([m.title, share, rs(m.baseMinor), rs(gstOf(m.baseMinor, input.gstRatePct)), rs(m.baseMinor + gstOf(m.baseMinor, input.gstRatePct))], false, h, m.trigger);
    }
    doc.moveDown(0.6);
  }

  // ---- signature boxes
  ensure(150);
  doc.moveDown(1).font('B').fontSize(13).fillColor(ACCENT).text('Signatures and acceptance', LEFT, doc.y, { width });
  doc.moveDown(0.4).font('R').fontSize(10).fillColor(INK).text('By signing, both parties confirm that they have read, understood and agree to be bound by this document.', LEFT, doc.y, { width });
  doc.moveDown(0.8);
  const sy = doc.y;
  const boxW = width / 2 - 6;
  [[LEFT, input.kind === 'agreement' ? 'FOR THE CLIENT' : 'FOR THE CLIENT', input.party.name], [LEFT + width / 2 + 6, 'FOR THE DEVELOPER', SUPPLIER.name]].forEach(([x, head, who]) => {
    doc.rect(x as number, sy, boxW, 24).fill(NAVY);
    doc.font('B').fontSize(9).fillColor('#FFFFFF').text(head as string, x as number, sy + 8, { width: boxW, align: 'center' });
    doc.rect(x as number, sy + 24, boxW, 96).lineWidth(0.8).strokeColor(LINE).stroke();
    doc.font('B').fontSize(9.5).fillColor(INK).text(who as string, (x as number) + 8, sy + 32, { width: boxW - 16 });
    doc.font('R').fontSize(8.5).fillColor(MUTED).text('Authorised signature and date', (x as number) + 8, sy + 100, { width: boxW - 16 });
  });
  doc.y = sy + 126;

  // ---- footer on every page
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.font('R').fontSize(8).fillColor(MUTED);
    const y = doc.page.height - 40;
    doc.page.margins.bottom = 0;
    doc.text(`${SUPPLIER.name} | GSTIN: ${SUPPLIER.gstin} | Confidential`, LEFT, y, { width: width - 60, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, LEFT + width - 60, y, { width: 60, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}

// Reads everything the document needs from the database, so the PDF is always built from the current details.
export async function renderStoredDeal(workspaceId: string, documentId: string): Promise<Buffer> {
  const [row] = await db
    .select({ doc: dealDocuments, client: clients, lead: leads })
    .from(dealDocuments)
    .leftJoin(clients, eq(clients.id, dealDocuments.clientId))
    .leftJoin(leads, eq(leads.id, dealDocuments.leadId))
    .where(and(eq(dealDocuments.id, documentId), eq(dealDocuments.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw new Error('Not found');
  const ms = await db.select().from(projectMilestones).where(eq(projectMilestones.documentId, documentId)).orderBy(asc(projectMilestones.position));
  const c = row.client;
  const l = row.lead;
  return renderDealPdf({
    kind: row.doc.kind as 'proposal' | 'agreement',
    title: row.doc.title,
    reference: row.doc.reference,
    issuedOn: row.doc.issuedOn,
    durationDays: row.doc.durationDays,
    baseMinor: row.doc.baseAmountMinor,
    gstRatePct: row.doc.gstRatePct,
    brief: row.doc.brief,
    party: {
      name: c?.company || c?.name || l?.company || l?.name || 'Client',
      lines: [c?.notes, c?.city, c?.phone, c?.email, l?.city, l?.phone].filter((v, i, a): v is string => Boolean(v) && a.indexOf(v) === i),
    },
    milestones: ms.map((m) => ({ title: m.title, trigger: m.trigger, baseMinor: m.baseMinor })),
    blocks: (row.doc.content ?? []) as Block[],
  });
}
