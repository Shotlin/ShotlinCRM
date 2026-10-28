import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { GstInvoice } from './calc';
import { buildInvoiceDocument, type LabelledLine } from './document';
import { SUPPLIER, signatoryName, signaturePath } from './supplier';

// Arimo is metric-compatible with Arial. It is embedded so the PDF looks the same in every viewer.
const FONT_DIR = path.join(process.cwd(), 'src/server/services/invoicing/assets/fonts');
const REGULAR = 'Shotlin-Regular';
const BOLD = 'Shotlin-Bold';

const NAVY = '#051321';
const GOLD = '#B08D21';
const GOLD_TEXT = '#B58F1F';
const SOFT = '#F8FAFC';
const SOFT_TOTAL = '#F7F9FB';
const INK = '#111827';
const GREY = '#464646';
const MUTED = '#707070';
const LINE = '#E2E8F0';

const PAGE = { width: 595.28, height: 841.89, left: 36, right: 36, top: 26, bottom: 26 };
const WIDTH = PAGE.width - PAGE.left - PAGE.right;
// Column widths are the template's Word widths (twips), scaled to the page.
const TWIPS = WIDTH / 10800;
const tw = (twips: number) => twips * TWIPS;

type Run = { text: string; bold?: boolean; color?: string };
type Para = { runs: Run[]; size: number; color?: string; align?: 'left' | 'right' | 'center'; after?: number };
type Cell = { w: number; fill?: string; paras: Para[]; padX?: number; padY?: number; borderBottom?: boolean };

const para = (text: string, size: number, opts: Partial<Omit<Para, 'runs' | 'size'>> & { bold?: boolean; color?: string } = {}): Para => ({
  runs: [{ text, bold: opts.bold }],
  size,
  color: opts.color,
  align: opts.align,
  after: opts.after,
});

const labelled = (line: LabelledLine, size: number, after = 2): Para => ({
  runs: line.label ? [{ text: `${line.label} `, bold: true }, { text: line.value }] : [{ text: line.value }],
  size,
  color: INK,
  after,
});

export async function renderInvoicePdf(invoice: GstInvoice): Promise<Buffer> {
  const content = buildInvoiceDocument(invoice);
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: PAGE.top, left: PAGE.left, right: PAGE.right, bottom: 0 },
    info: { Title: content.docNo, Author: SUPPLIER.name },
    autoFirstPage: true,
  });
  doc.registerFont(REGULAR, readFileSync(path.join(FONT_DIR, 'arimo-latin-400-normal.woff')));
  doc.registerFont(BOLD, readFileSync(path.join(FONT_DIR, 'arimo-latin-700-normal.woff')));
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  let y = PAGE.top;
  const bottomLimit = PAGE.height - PAGE.bottom;

  const fontFor = (run: Run) => (run.bold ? BOLD : REGULAR);
  const paraText = (p: Para) => p.runs.map((run) => run.text).join('');

  const measure = (cell: Cell) => {
    const padX = cell.padX ?? 6;
    const padY = cell.padY ?? 4;
    const innerWidth = cell.w - padX * 2;
    let height = padY * 2;
    for (const p of cell.paras) {
      const allBold = p.runs.every((run) => run.bold);
      doc.font(allBold ? BOLD : REGULAR).fontSize(p.size);
      // Mixed bold/regular lines are measured slightly wider so a fill never clips text.
      const text = p.runs.some((run) => run.bold) && !allBold ? `${paraText(p)}  ` : paraText(p);
      height += doc.heightOfString(text, { width: innerWidth, align: p.align }) + (p.after ?? 0);
    }
    return height;
  };

  const drawCellText = (cell: Cell, x: number, top: number) => {
    const padX = cell.padX ?? 6;
    const padY = cell.padY ?? 4;
    let cursor = top + padY;
    for (const p of cell.paras) {
      doc.fontSize(p.size);
      p.runs.forEach((run, index) => {
        doc.font(fontFor(run)).fillColor(run.color ?? p.color ?? INK);
        const options = {
          width: cell.w - padX * 2,
          align: p.align ?? 'left',
          continued: index < p.runs.length - 1,
          lineGap: 0,
        } as const;
        if (index === 0) doc.text(run.text, x + padX, cursor, options);
        else doc.text(run.text, options);
      });
      cursor = doc.y + (p.after ?? 0);
    }
  };

  const row = (cells: Cell[], opts: { gapAfter?: number } = {}) => {
    const height = Math.max(...cells.map(measure));
    if (y + height > bottomLimit) {
      doc.addPage({ margins: { top: PAGE.top, left: PAGE.left, right: PAGE.right, bottom: 0 } });
      y = PAGE.top;
    }
    let x = PAGE.left;
    for (const cell of cells) {
      if (cell.fill) doc.rect(x, y, cell.w, height).fill(cell.fill);
      drawCellText(cell, x, y);
      if (cell.borderBottom) {
        doc.moveTo(x, y + height).lineTo(x + cell.w, y + height).lineWidth(0.5).strokeColor(LINE).stroke();
      }
      x += cell.w;
    }
    y += height + (opts.gapAfter ?? 0);
    return height;
  };

  // ---- 1. Header: brand and address on the left, document title on the right ----
  const supplier = content.supplierLines;
  row(
    [
      {
        w: tw(6336),
        padX: 0,
        paras: [
          para(SUPPLIER.brand, 22, { bold: true, color: NAVY, after: 2 }),
          para(supplier[0], 7.5, { bold: true, color: '#232323' }),
          para(supplier[1], 7.5, { color: '#232323' }),
          para(supplier[2], 7.5, { color: '#232323' }),
          para(supplier[3], 7.5, { bold: true, color: '#232323' }),
        ],
      },
      {
        w: tw(4464),
        padX: 0,
        paras: [
          para(content.heading.title, content.heading.title.length > 12 ? 16 : 20, { bold: true, color: NAVY, align: 'right', after: 3 }),
          para('ORIGINAL FOR RECIPIENT', 8, { bold: true, color: MUTED, align: 'right', after: 2 }),
          ...(content.heading.subtitle
            ? [para(content.heading.subtitle, 9, { bold: true, color: GOLD_TEXT, align: 'right', after: 3 })]
            : []),
          para(`${content.heading.numberLabel}: ${content.docNo}`, 12, { bold: true, color: NAVY, align: 'right' }),
        ],
      },
    ],
    { gapAfter: 4 },
  );

  // ---- 2. Gold rule ----
  doc.rect(PAGE.left, y, WIDTH, 3).fill(GOLD);
  y += 3 + 6;

  // ---- 3. Date / SAC / supply type / terms / payment status ----
  const metaWidths = [2015, 1584, 1800, 2880, 2520].map(tw);
  row(
    content.meta.labels.map((label, i) => ({
      w: metaWidths[i],
      fill: NAVY,
      paras: [para(label, 8, { bold: true, color: '#FFFFFF', align: 'center' })],
    })),
  );
  row(
    content.meta.values.map((value, i) => ({
      w: metaWidths[i],
      fill: SOFT,
      paras: [para(value, 8, { bold: true, color: INK, align: 'center' })],
      padY: 5,
    })),
    { gapAfter: 8 },
  );

  // ---- 4. Billed to / project ----
  row(
    [
      {
        w: tw(5400),
        fill: SOFT,
        padX: 8,
        padY: 7,
        paras: [para('BILLED TO', 9.5, { bold: true, color: NAVY, after: 3 }), ...content.billed.map((line) => labelled(line, 8))],
      },
      {
        w: tw(5400),
        fill: SOFT,
        padX: 8,
        padY: 7,
        paras: [para('PROJECT / SERVICE', 9.5, { bold: true, color: NAVY, after: 3 }), ...content.project.map((line) => labelled(line, 8))],
      },
    ],
    { gapAfter: 10 },
  );

  // ---- 5. Line items ----
  doc.font(BOLD).fontSize(9.5).fillColor(NAVY).text('LINE ITEMS', PAGE.left, y, { width: WIDTH });
  y = doc.y + 4;
  const itemWidths = [604, 3384, 835, 1411, 1324, 1411, 1411].map((value) => tw((value * 10800) / 10380));
  const itemHead = ['#', 'Description', 'Qty', 'Taxable Value', 'Tax Rate', 'Tax Amount', 'Amount'];
  row(
    itemHead.map((label, i) => ({
      w: itemWidths[i],
      fill: NAVY,
      paras: [para(label, 8, { bold: true, color: '#FFFFFF', align: i === 1 ? 'left' : 'center' })],
    })),
  );
  for (const item of content.items) {
    const cells = [item.index, item.description, item.qty, item.taxable, item.rate, item.tax, item.amount];
    row(
      cells.map((text, i) => ({
        w: itemWidths[i],
        borderBottom: true,
        padY: 5,
        paras:
          i === 1
            ? [para(text, 8, { bold: true, color: INK, after: item.detail ? 2 : 0 }), ...(item.detail ? [para(item.detail, 7, { color: GREY })] : [])]
            : [para(text, i === 4 ? 7.5 : 8, { bold: i === 6, color: INK, align: i >= 3 && i !== 4 ? 'right' : 'center' })],
      })),
    );
  }
  y += 8;

  // ---- 6. Amount in words and notes (left) beside the totals (right) ----
  const leftCell: Cell = {
    w: tw(5472),
    padX: 0,
    paras: content.leftNotes.map((note) => ({
      runs: [{ text: `${note.label} `, bold: true }, { text: note.text, color: note.label === 'Amount in Words:' ? INK : GREY }],
      size: 8,
      color: INK,
      after: 4,
    })),
  };
  const totalsX = PAGE.left + leftCell.w + tw(240);
  const totalsLabelW = tw(2808);
  const totalsValueW = tw(2232);
  const totalRows = content.totals.map((totalRow) => ({
    row: totalRow,
    h: measure({ w: totalsLabelW, padY: 4, paras: [para(totalRow.label, 8, { bold: true })] }),
  }));
  const totalsHeight = totalRows.reduce((sum, item) => sum + item.h, 0);
  const blockHeight = Math.max(measure(leftCell), totalsHeight);
  if (y + blockHeight > bottomLimit) {
    doc.addPage({ margins: { top: PAGE.top, left: PAGE.left, right: PAGE.right, bottom: 0 } });
    y = PAGE.top;
  }
  drawCellText(leftCell, PAGE.left, y);
  let ty = y;
  for (const { row: totalRow, h } of totalRows) {
    const labelFill = totalRow.grand ? NAVY : SOFT_TOTAL;
    const valueFill = totalRow.grand ? NAVY : '#FFFFFF';
    const textColor = totalRow.grand ? '#FFFFFF' : INK;
    doc.rect(totalsX, ty, totalsLabelW, h).fill(labelFill);
    doc.rect(totalsX + totalsLabelW, ty, totalsValueW, h).fill(valueFill);
    drawCellText({ w: totalsLabelW, padY: 4, paras: [para(totalRow.label, 8, { bold: true, color: textColor })] }, totalsX, ty);
    drawCellText(
      { w: totalsValueW, padY: 4, paras: [para(totalRow.value, 8, { bold: true, color: textColor, align: 'right' })] },
      totalsX + totalsLabelW,
      ty,
    );
    if (!totalRow.grand) {
      doc.moveTo(totalsX, ty + h).lineTo(totalsX + totalsLabelW + totalsValueW, ty + h).lineWidth(0.5).strokeColor(LINE).stroke();
    }
    ty += h;
  }
  y += blockHeight + 12;

  // ---- 7. Notes and terms ----
  const termsCell: Cell = {
    w: WIDTH,
    padX: 0,
    paras: [
      para('NOTES & TERMS', 9.5, { bold: true, color: NAVY, after: 4 }),
      ...content.terms.map((term, i) => para(`${i + 1}. ${term}`, 7.5, { color: GREY, after: 3 })),
    ],
  };
  row([termsCell], { gapAfter: 14 });

  // ---- 8. Signature and footer ----
  const signatureFile = signaturePath();
  const signatureBytes = existsSync(signatureFile) ? readFileSync(signatureFile) : null;
  const signatureHeight = 34;
  const leftSig: Cell = {
    w: tw(5472),
    padX: 0,
    paras: [
      para(`For ${SUPPLIER.name}`, 8.5, { bold: true, color: INK, after: signatureBytes ? signatureHeight + 6 : 22 }),
      para(`${signatoryName()}, Proprietor`, 7, { color: GREY }),
      para('Authorised Signatory & Date', 7, { color: GREY }),
    ],
  };
  const rightSig: Cell = {
    w: tw(5328),
    padX: 0,
    paras: [para(content.footerLeft, 7, { color: GREY, align: 'right', after: 2 }), para(content.footerRight, 7, { color: GREY, align: 'right' })],
  };
  const sigTop = y;
  row([leftSig, rightSig]);
  if (signatureBytes) {
    doc.image(signatureBytes, PAGE.left, sigTop + 4 + 11, { height: signatureHeight });
  }

  doc.end();
  return finished;
}
