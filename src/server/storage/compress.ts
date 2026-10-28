import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type Optimized = { buffer: Buffer; mimeType: string };
// 'received' files come from customers and are shown only inside the CRM, so images become WebP.
// 'outgoing' files are sent on to WhatsApp, so images keep a format every phone opens.
export type OptimizeMode = 'received' | 'outgoing';

const MAX_SIDE = 1600;
const KEEP_IF_SMALLER_THAN = 0.95;

async function optimizeImage(buffer: Buffer, mimeType: string, mode: OptimizeMode): Promise<Optimized> {
  const { default: sharp } = await import('sharp');
  const meta = await sharp(buffer, { failOn: 'none' }).metadata();
  // Animated pictures and stickers are left alone; small WebP files are already compact.
  if ((meta.pages ?? 1) > 1) return { buffer, mimeType };
  if (mimeType === 'image/webp' && buffer.length < 300 * 1024) return { buffer, mimeType };

  const base = sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true });
  let result: Optimized;
  if (mode === 'received' || mimeType === 'image/webp') {
    result = { buffer: await base.webp({ quality: 72, effort: 4 }).toBuffer(), mimeType: 'image/webp' };
  } else if (mimeType === 'image/png') {
    result = { buffer: await base.png({ compressionLevel: 9, palette: true }).toBuffer(), mimeType };
  } else {
    result = { buffer: await base.jpeg({ quality: 80, mozjpeg: true }).toBuffer(), mimeType: 'image/jpeg' };
  }
  return result.buffer.length < buffer.length * KEEP_IF_SMALLER_THAN ? result : { buffer, mimeType };
}

function runGhostscript(bin: string, input: string, output: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(bin, [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.5',
      '-dPDFSETTINGS=/ebook',
      '-dSubsetFonts=true',
      '-dCompressFonts=true',
      '-dNOPAUSE',
      '-dBATCH',
      '-dQUIET',
      `-sOutputFile=${output}`,
      input,
    ]);
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

// Ghostscript (when installed) shrinks embedded fonts and pictures. Without it the file is only
// re-packed, which saves a little. A result is used only when it is clearly smaller and still a PDF.
export async function optimizePdf(buffer: Buffer): Promise<Buffer> {
  let best = buffer;
  const dir = await mkdtemp(path.join(tmpdir(), 'crm-pdf-'));
  try {
    const input = path.join(dir, 'in.pdf');
    const output = path.join(dir, 'out.pdf');
    await writeFile(input, buffer);
    if (await runGhostscript(process.env.GS_BIN ?? 'gs', input, output)) {
      const compact = await readFile(output);
      if (compact.subarray(0, 5).toString() === '%PDF-' && compact.length < best.length * KEEP_IF_SMALLER_THAN) best = compact;
    }
  } catch {
    // keep the original
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  if (best === buffer) {
    try {
      const { PDFDocument } = await import('pdf-lib');
      const doc = await PDFDocument.load(buffer, { updateMetadata: false });
      const packed = Buffer.from(await doc.save({ useObjectStreams: true }));
      if (packed.length < buffer.length * KEEP_IF_SMALLER_THAN) best = packed;
    } catch {
      // encrypted or damaged files are stored as received
    }
  }
  return best;
}

export async function optimizeMedia(buffer: Buffer, mimeType: string, mode: OptimizeMode): Promise<Optimized> {
  try {
    if (mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp') {
      return await optimizeImage(buffer, mimeType, mode);
    }
    if (mimeType === 'application/pdf') return { buffer: await optimizePdf(buffer), mimeType };
  } catch {
    // Never lose a file because it could not be shrunk.
  }
  return { buffer, mimeType };
}
