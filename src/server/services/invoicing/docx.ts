import { existsSync, readFileSync } from 'node:fs';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import type { GstInvoice } from './calc';
import { buildInvoiceDocument, type LabelledLine } from './document';
import { SUPPLIER, signatoryName, signaturePath } from './supplier';

const NAVY = '051321';
const GOLD = 'B08D21';
const GOLD_TEXT = 'B58F1F';
const SOFT = 'F8FAFC';
const SOFT_TOTAL = 'F7F9FB';
const INK = '111827';
const GREY = '464646';
const MUTED = '707070';
const LINE = 'E2E8F0';
const FONT = 'Arial';

// A4 with the template's 720-twip side margins leaves 10469 twips; the template's own
// table widths add up to 10800, so every width is scaled to fit exactly.
const CONTENT = 10469;
const fit = (twips: number) => Math.round((twips * CONTENT) / 10800);

type Run = { text: string; bold?: boolean; color?: string };
type Align = 'left' | 'right' | 'center';

const ALIGN = {
  left: AlignmentType.LEFT,
  right: AlignmentType.RIGHT,
  center: AlignmentType.CENTER,
} as const;

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const;
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER } as const;

function paragraph(runs: Run[], size: number, opts: { color?: string; align?: Align; after?: number } = {}) {
  return new Paragraph({
    alignment: ALIGN[opts.align ?? 'left'],
    spacing: { after: Math.round((opts.after ?? 0) * 20), line: 240 },
    children: runs.map(
      (run) =>
        new TextRun({
          text: run.text,
          bold: run.bold,
          color: run.color ?? opts.color ?? INK,
          size: Math.round(size * 2),
          font: FONT,
        }),
    ),
  });
}

const text = (value: string, size: number, opts: { bold?: boolean; color?: string; align?: Align; after?: number } = {}) =>
  paragraph([{ text: value, bold: opts.bold }], size, opts);

const labelled = (line: LabelledLine, size: number, after = 2) =>
  paragraph(line.label ? [{ text: `${line.label} `, bold: true }, { text: line.value }] : [{ text: line.value }], size, { after });

function cell(
  width: number,
  children: Paragraph[],
  opts: { fill?: string; margin?: number; marginY?: number; bottomLine?: boolean; span?: number } = {},
) {
  const x = opts.margin ?? 120;
  const y = opts.marginY ?? 80;
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: opts.span,
    verticalAlign: VerticalAlign.TOP,
    shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill, color: 'auto' } : undefined,
    margins: { top: y, bottom: y, left: x, right: x },
    borders: opts.bottomLine
      ? { ...NO_BORDERS, bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE } }
      : NO_BORDERS,
    children,
  });
}

function table(widths: number[], rows: TableRow[]) {
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: { ...NO_BORDERS, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows,
  });
}

const spacer = (points: number) => new Paragraph({ spacing: { after: Math.round(points * 20), line: 20 }, children: [] });

export async function renderInvoiceDocx(invoice: GstInvoice): Promise<Buffer> {
  const content = buildInvoiceDocument(invoice);
  const supplier = content.supplierLines;
  const blocks: (Paragraph | Table)[] = [];

  // 1. Header
  const headerWidths = [fit(6336), fit(4464)];
  blocks.push(
    table(headerWidths, [
      new TableRow({
        children: [
          cell(
            headerWidths[0],
            [
              text(SUPPLIER.brand, 22, { bold: true, color: NAVY, after: 2 }),
              text(supplier[0], 7.5, { bold: true, color: '232323' }),
              text(supplier[1], 7.5, { color: '232323' }),
              text(supplier[2], 7.5, { color: '232323' }),
              text(supplier[3], 7.5, { bold: true, color: '232323' }),
            ],
            { margin: 0 },
          ),
          cell(
            headerWidths[1],
            [
              text(content.heading.title, content.heading.title.length > 12 ? 16 : 20, { bold: true, color: NAVY, align: 'right', after: 3 }),
              text('ORIGINAL FOR RECIPIENT', 8, { bold: true, color: MUTED, align: 'right', after: 2 }),
              ...(content.heading.subtitle
                ? [text(content.heading.subtitle, 9, { bold: true, color: GOLD_TEXT, align: 'right', after: 3 })]
                : []),
              text(`${content.heading.numberLabel}: ${content.docNo}`, 12, { bold: true, color: NAVY, align: 'right' }),
            ],
            { margin: 0 },
          ),
        ],
      }),
    ]),
  );
  blocks.push(spacer(4));

  // 2. Gold rule
  blocks.push(
    table([CONTENT], [
      new TableRow({
        height: { value: 60, rule: 'exact' },
        children: [cell(CONTENT, [spacer(0)], { fill: GOLD, margin: 0, marginY: 0 })],
      }),
    ]),
  );
  blocks.push(spacer(6));

  // 3. Meta strip
  const metaWidths = [2015, 1584, 1800, 2880, 2520].map(fit);
  blocks.push(
    table(metaWidths, [
      new TableRow({
        children: content.meta.labels.map((label, i) =>
          cell(metaWidths[i], [text(label, 8, { bold: true, color: 'FFFFFF', align: 'center' })], { fill: NAVY }),
        ),
      }),
      new TableRow({
        children: content.meta.values.map((value, i) =>
          cell(metaWidths[i], [text(value, 8, { bold: true, align: 'center' })], { fill: SOFT, marginY: 100 }),
        ),
      }),
    ]),
  );
  blocks.push(spacer(8));

  // 4. Billed to / project
  const halfWidths = [fit(5400), fit(5400)];
  blocks.push(
    table(halfWidths, [
      new TableRow({
        children: [
          cell(halfWidths[0], [text('BILLED TO', 9.5, { bold: true, color: NAVY, after: 3 }), ...content.billed.map((line) => labelled(line, 8))], {
            fill: SOFT,
            margin: 160,
            marginY: 140,
          }),
          cell(halfWidths[1], [text('PROJECT / SERVICE', 9.5, { bold: true, color: NAVY, after: 3 }), ...content.project.map((line) => labelled(line, 8))], {
            fill: SOFT,
            margin: 160,
            marginY: 140,
          }),
        ],
      }),
    ]),
  );
  blocks.push(spacer(10));

  // 5. Line items
  blocks.push(text('LINE ITEMS', 9.5, { bold: true, color: NAVY, after: 4 }));
  const itemWidths = [604, 3384, 835, 1411, 1324, 1411, 1411].map((value) => fit((value * 10800) / 10380));
  const itemHead = ['#', 'Description', 'Qty', 'Taxable Value', 'Tax Rate', 'Tax Amount', 'Amount'];
  blocks.push(
    table(itemWidths, [
      new TableRow({
        tableHeader: true,
        children: itemHead.map((label, i) =>
          cell(itemWidths[i], [text(label, 8, { bold: true, color: 'FFFFFF', align: i === 1 ? 'left' : 'center' })], { fill: NAVY }),
        ),
      }),
      ...content.items.map((item) => {
        const values = [item.index, item.description, item.qty, item.taxable, item.rate, item.tax, item.amount];
        return new TableRow({
          cantSplit: true,
          children: values.map((value, i) =>
            cell(
              itemWidths[i],
              i === 1
                ? [text(value, 8, { bold: true, after: item.detail ? 2 : 0 }), ...(item.detail ? [text(item.detail, 7, { color: GREY })] : [])]
                : [text(value, i === 4 ? 7.5 : 8, { bold: i === 6, align: i >= 3 && i !== 4 ? 'right' : 'center' })],
              { bottomLine: true, marginY: 100 },
            ),
          ),
        });
      }),
    ]),
  );
  blocks.push(spacer(8));

  // 6. Words and notes beside the totals
  const leftWidth = fit(5472);
  const gapWidth = fit(240);
  const labelWidth = fit(2808);
  const valueWidth = fit(2232);
  const noteParagraphs = content.leftNotes.map((note) =>
    paragraph(
      [{ text: `${note.label} `, bold: true }, { text: note.text, color: note.label === 'Amount in Words:' ? INK : GREY }],
      8,
      { after: 4 },
    ),
  );
  const totalsTable = table(
    [labelWidth, valueWidth],
    content.totals.map(
      (row) =>
        new TableRow({
          children: [
            cell(labelWidth, [text(row.label, 8, { bold: true, color: row.grand ? 'FFFFFF' : INK })], {
              fill: row.grand ? NAVY : SOFT_TOTAL,
              bottomLine: !row.grand,
            }),
            cell(valueWidth, [text(row.value, 8, { bold: true, color: row.grand ? 'FFFFFF' : INK, align: 'right' })], {
              fill: row.grand ? NAVY : undefined,
              bottomLine: !row.grand,
            }),
          ],
        }),
    ),
  );
  blocks.push(
    table([leftWidth, gapWidth, labelWidth + valueWidth], [
      new TableRow({
        cantSplit: true,
        children: [
          cell(leftWidth, noteParagraphs, { margin: 0, marginY: 0 }),
          cell(gapWidth, [spacer(0)], { margin: 0, marginY: 0 }),
          new TableCell({
            width: { size: labelWidth + valueWidth, type: WidthType.DXA },
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            borders: NO_BORDERS,
            children: [totalsTable, spacer(0)],
          }),
        ],
      }),
    ]),
  );
  blocks.push(spacer(12));

  // 7. Notes and terms
  blocks.push(text('NOTES & TERMS', 9.5, { bold: true, color: NAVY, after: 4 }));
  content.terms.forEach((term, i) => blocks.push(text(`${i + 1}. ${term}`, 7.5, { color: GREY, after: 3 })));
  blocks.push(spacer(14));

  // 8. Signature and footer
  const signatureFile = signaturePath();
  const signature = existsSync(signatureFile) ? readFileSync(signatureFile) : null;
  const sigWidths = [fit(5472), fit(5328)];
  blocks.push(
    table(sigWidths, [
      new TableRow({
        cantSplit: true,
        children: [
          cell(
            sigWidths[0],
            [
              text(`For ${SUPPLIER.name}`, 8.5, { bold: true, after: 4 }),
              signature
                ? new Paragraph({
                    spacing: { after: 80 },
                    children: [new ImageRun({ type: 'png', data: signature, transformation: { width: 101, height: 44 } })],
                  })
                : spacer(22),
              text(`${signatoryName()}, Proprietor`, 7, { color: GREY }),
              text('Authorised Signatory & Date', 7, { color: GREY }),
            ],
            { margin: 0, marginY: 0 },
          ),
          cell(
            sigWidths[1],
            [text(content.footerLeft, 7, { color: GREY, align: 'right', after: 2 }), text(content.footerRight, 7, { color: GREY, align: 'right' })],
            { margin: 0, marginY: 0 },
          ),
        ],
      }),
    ]),
  );

  const document = new Document({
    creator: SUPPLIER.name,
    title: content.docNo,
    styles: { default: { document: { run: { font: FONT, size: 16 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11909, height: 16834 },
            margin: { top: 520, right: 720, bottom: 520, left: 720, header: 720, footer: 720 },
          },
        },
        children: blocks,
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(document));
}
