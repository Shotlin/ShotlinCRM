import { describe, expect, it } from 'vitest';
import { createHarness, TOKEN } from './testing/appsScriptHarness';

const pdf = Buffer.from('%PDF-1.4 sample bytes').toString('base64');
const docx = Buffer.from('PK sample word bytes').toString('base64');

const files = (name = 'Shotlin_Sample_Final_Invoice_SL-INV-26-27-101') => [
  { kind: 'pdf', name: `${name}.pdf`, mimeType: 'application/pdf', base64: pdf },
  { kind: 'docx', name: `${name}.docx`, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', base64: docx },
];

const seriesRow = (docNo = 'SL/INV/26-27/101', serial = 101) => ({
  sheet: 'GST_Series',
  key: docNo,
  values: {
    A: 'FY26-27', B: 'Q2 (Jul-Sep)', C: 'Jul-26', D: 'INV', E: serial, F: docNo, G: { date: '2026-07-06' },
    H: 'Final Invoice', I: 'Sample Client', J: 'Sample Project', K: 'Gujarat (24)', L: 'Unregistered', M: '998314',
    N: 'Inter-State Service', O: 'IGST', P: 0.18, Q: 14999, R: 0, S: 0, T: 2699.82, V: 0.18, W: 17699, X: 0, Y: 17699,
    Z: 'PAYABLE / DUE', AA: 'Current Quarter / Not Filed', AB: 'Q2 (Jul-Sep) FY26-27', AC: 'sample.pdf', AD: '',
  },
  links: { AC: { text: 'sample.pdf', url: 'https://drive.google.com/file/d/file-1/view' } },
});

describe('security', () => {
  it('rejects a missing, wrong or short token and does nothing', () => {
    const h = createHarness();
    expect(h.call({ action: 'selfTest' }, null).ok).toBe(false);
    expect(h.call({ action: 'selfTest' }, 'wrong-token-0123456789-abcdefghij').error).toBe('Not authorised');
    expect(h.call({ action: 'selfTest' }, TOKEN.slice(0, 10)).error).toBe('Not authorised');
    expect(h.call({ ...seriesRow() }, 'wrong-token-0123456789-abcdefghij').ok).toBe(false);
    expect(h.series.cell('F7')).toBeUndefined();
  });

  it('refuses to work when no token has been configured', () => {
    const h = createHarness({ token: null });
    expect(h.call({ action: 'selfTest' }, 'anything-anything-anything-12345').error).toMatch(/TOKEN script property/);
  });

  it('answers a plain browser visit without revealing anything', () => {
    expect(createHarness().get()).toEqual({ ok: true, service: 'shotlin-drive-link' });
  });

  it('turns bad requests into errors and always releases the lock', () => {
    const h = createHarness();
    expect(h.callRaw('{not json').ok).toBe(false);
    expect(h.call({ action: 'dropEverything' }).error).toMatch(/Unknown action/);
    expect(h.lockHeld()).toBe(false);
  });
});

describe('selfTest and header protection', () => {
  it('passes on a correctly laid out workbook and adds the ledger key column', () => {
    const h = createHarness();
    const res = h.call({ action: 'selfTest' });
    expect(res.ok).toBe(true);
    expect(res.result.sheets).toEqual({ GST_Series: 'ok', GST_Pending: 'ok', Pay_Ledger: 'ok' });
    expect(res.result.workbook).toBe('Shotlin GST Master - CRM TEST');
    expect(res.result.folders).toEqual({
      invoiceRoot: '01 - GST Invoice PDFs',
      pending: '00 - Pending GST Invoices',
      dataRoom: 'Shotlin GST Master - CRM TEST',
      consistent: 'ok',
    });
    expect(h.ledger.cell('N5')).toBe('CRM Payment ID');
  });

  it('stops, and writes nothing, if a column heading has moved', () => {
    const h = createHarness();
    h.series.put('F6', 'Document Number');
    const res = h.call({ ...seriesRow(), action: 'upsertRow' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/column F should be "Doc No" but is "Document Number"/);
    expect(h.series.cell('F7')).toBeUndefined();
  });

  it('has no built-in folder or sheet, so nothing can be written until each is set on purpose', () => {
    const noSheet = createHarness({ sheetId: null });
    const res = noSheet.call({ action: 'upsertRow', ...seriesRow() });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/SHEET_ID script property is not set/);

    const noRoot = createHarness({ rootId: null });
    expect(noRoot.call({ action: 'saveFiles', destination: 'quarter', quarterFolderName: 'Q1 (Apr-Jun 2026)', files: files() }).error).toMatch(
      /INVOICE_ROOT_ID script property is not set/,
    );
    const noPending = createHarness({ pendingId: null });
    expect(noPending.call({ action: 'saveFiles', destination: 'pending', files: files() }).error).toMatch(
      /PENDING_FOLDER_ID script property is not set/,
    );
    expect(noPending.drive.live(noPending.pendingFolder())).toHaveLength(0);
    for (const h of [noSheet, noRoot, noPending]) expect(h.call({ action: 'selfTest' }).ok).toBe(false);
  });

  it('refuses a Pending folder that belongs to a different copy of the data room', () => {
    const h = createHarness({ pendingId: 'other-copy-pending' });
    expect(h.call({ action: 'selfTest' }).error).toMatch(/Pending folder is not inside the invoice folder/);
  });

  it('refuses an unexpected heading in the ledger key column', () => {
    const h = createHarness();
    h.ledger.put('N5', 'Something else');
    expect(h.call({ action: 'selfTest' }).error).toMatch(/column N should be "CRM Payment ID"/);
  });
});

describe('upsertRow on the register', () => {
  it('writes a new row into the first empty row and leaves the formula columns alone', () => {
    const h = createHarness();
    const res = h.call({ action: 'upsertRow', ...seriesRow() });
    expect(res.result).toEqual({ found: false, created: true, row: 7 });
    expect(h.series.cell('F7')).toBe('SL/INV/26-27/101');
    expect(h.series.cell('T7')).toBe(2699.82);
    expect(h.series.cell('U7')).toBeUndefined();
    expect(h.series.cell('AE7')).toBeUndefined();
    expect(h.series.formulas.get('7,21')).toBe('=SUM(R7:T7)');
    expect(h.series.formulas.get('7,31')).toMatch(/COUNTIFS/);
  });

  it('writes the date as a real date and applies the number formats', () => {
    const h = createHarness();
    h.call({ action: 'upsertRow', ...seriesRow() });
    const date = h.series.cell('G7') as Date;
    expect([date.getFullYear(), date.getMonth() + 1, date.getDate()]).toEqual([2026, 7, 6]);
    expect(h.series.formats.get('7,7')).toBe('dd mmm yyyy');
    expect(h.series.formats.get('7,17')).toBe('"₹"#,##0.00');
    expect(h.series.formats.get('7,16')).toBe('0.0%');
  });

  it('stores the PDF link as a clickable cell', () => {
    const h = createHarness();
    h.call({ action: 'upsertRow', ...seriesRow() });
    expect(h.series.links.get('7,29')).toEqual({ text: 'sample.pdf', url: 'https://drive.google.com/file/d/file-1/view' });
  });

  it('updates the same row on the next call instead of adding another', () => {
    const h = createHarness();
    h.call({ action: 'upsertRow', ...seriesRow() });
    const again = seriesRow();
    again.values.X = 17699;
    again.values.Y = 0;
    again.values.Z = 'PAID IN FULL';
    const res = h.call({ action: 'upsertRow', ...again });
    expect(res.result).toEqual({ found: true, created: false, row: 7 });
    expect(h.series.cell('Z7')).toBe('PAID IN FULL');
    expect(h.series.cell('F8')).toBeUndefined();
  });

  it('keeps hand-maintained columns (filing status, notes) once a row exists', () => {
    const h = createHarness();
    h.call({ action: 'upsertRow', ...seriesRow() });
    h.series.put('AA7', 'Filed on 20 Jul');
    h.series.put('AD7', 'Checked with CA');
    const changed = seriesRow();
    changed.values.AA = 'Current Quarter / Not Filed';
    changed.values.AD = 'overwritten?';
    h.call({ action: 'upsertRow', ...changed });
    expect(h.series.cell('AA7')).toBe('Filed on 20 Jul');
    expect(h.series.cell('AD7')).toBe('Checked with CA');
  });

  it('overwrites a hand-maintained column only when told to', () => {
    const h = createHarness();
    h.call({ action: 'upsertRow', ...seriesRow() });
    h.series.put('AA7', 'Filed on 20 Jul');
    const changed = seriesRow();
    changed.values.AA = 'Reviewed';
    h.call({ action: 'upsertRow', ...changed, overwrite: ['AA'] });
    expect(h.series.cell('AA7')).toBe('Reviewed');
  });

  it('appends a note after existing text, once', () => {
    const h = createHarness();
    h.call({ action: 'upsertRow', ...seriesRow() });
    h.series.put('AD7', 'Checked with CA');
    const note = { appendNotes: { AD: 'CANCELLED: issued in error' } };
    h.call({ action: 'upsertRow', ...seriesRow(), ...note });
    h.call({ action: 'upsertRow', ...seriesRow(), ...note });
    expect(h.series.cell('AD7')).toBe('Checked with CA | CANCELLED: issued in error');
  });

  it('puts the next invoice in the next free row', () => {
    const h = createHarness();
    h.call({ action: 'upsertRow', ...seriesRow() });
    const second = h.call({ action: 'upsertRow', ...seriesRow('SL/INV/26-27/102', 102) });
    expect(second.result.row).toBe(8);
  });

  it('never writes to a formula column', () => {
    const h = createHarness();
    const bad = seriesRow();
    (bad.values as Record<string, unknown>).U = 123;
    const res = h.call({ action: 'upsertRow', ...bad });
    expect(res.error).toMatch(/Column U is a formula column/);
  });

  it('only updates an existing row when asked, and creates nothing otherwise', () => {
    const h = createHarness();
    const res = h.call({ action: 'upsertRow', sheet: 'GST_Pending', key: 'SL/ADV/26-27/108', onlyIfExists: true, values: { R: 'Promoted / Paid' } });
    expect(res.result).toEqual({ found: false, created: false });
    expect(h.pending.cell('F8')).toBeUndefined();
  });

  it('reports a full sheet instead of overwriting anything', () => {
    const h = createHarness();
    for (let row = 8; row <= 107; row++) h.pending.put(`F${row}`, `SL/ADV/26-27/${row}`);
    const res = h.call({ action: 'upsertRow', sheet: 'GST_Pending', key: 'SL/ADV/26-27/999', values: { D: 'ADV' } });
    expect(res.error).toMatch(/no empty rows left/);
    expect(h.pending.cell('F107')).toBe('SL/ADV/26-27/107');
  });

  it('rejects an unknown sheet and a missing key', () => {
    const h = createHarness();
    expect(h.call({ action: 'upsertRow', sheet: 'Secrets', key: 'x', values: {} }).error).toMatch(/Unknown sheet/);
    expect(h.call({ action: 'upsertRow', sheet: 'GST_Series', key: ' ', values: {} }).error).toMatch(/row key is required/);
  });
});

describe('the pending tab and the payment ledger', () => {
  it('reserves a pending row and later marks it promoted without moving it', () => {
    const h = createHarness();
    h.call({ action: 'upsertRow', sheet: 'GST_Pending', key: 'SL/ADV/26-27/108', values: { A: 'FY26-27', D: 'ADV', E: 108, R: 'Reserved / Pending' } });
    expect(h.pending.cell('R8')).toBe('Reserved / Pending');
    const res = h.call({ action: 'upsertRow', sheet: 'GST_Pending', key: 'SL/ADV/26-27/108', onlyIfExists: true, values: { R: 'Promoted / Paid' } });
    expect(res.result).toMatchObject({ found: true, row: 8 });
    expect(h.pending.cell('R8')).toBe('Promoted / Paid');
    expect(h.pending.cell('E8')).toBe(108);
  });

  it('writes each payment once, keyed by its CRM id', () => {
    const h = createHarness();
    const payment = (amount: number) => ({
      action: 'upsertRow', sheet: 'Pay_Ledger', key: 'payment-1',
      values: { A: { date: '2026-07-10' }, D: 'SL/INV/26-27/101', E: 'Part payment', H: amount, N: 'payment-1' },
    });
    expect(h.call(payment(5000)).result).toMatchObject({ created: true, row: 6 });
    expect(h.call(payment(6000)).result).toMatchObject({ created: false, row: 6 });
    expect(h.ledger.cell('H6')).toBe(6000);
    expect(h.ledger.cell('N7')).toBeUndefined();
  });
});

describe('saveFiles', () => {
  const bytesOf = (file: { bytes: number[] }) => Buffer.from(file.bytes).toString();

  it('saves both files into the Pending folder with their bytes intact', () => {
    const h = createHarness();
    const res = h.call({ action: 'saveFiles', destination: 'pending', files: files() });
    expect(res.ok).toBe(true);
    expect(res.result.folderName).toBe('00 - Pending GST Invoices');
    const saved = h.drive.live(h.pendingFolder());
    expect(saved.map((file) => file.name).sort()).toEqual([
      'Shotlin_Sample_Final_Invoice_SL-INV-26-27-101.docx',
      'Shotlin_Sample_Final_Invoice_SL-INV-26-27-101.pdf',
    ]);
    expect(bytesOf(saved.find((file) => file.name.endsWith('.pdf'))!)).toBe('%PDF-1.4 sample bytes');
    expect(res.result.files.map((file: { kind: string }) => file.kind)).toEqual(['pdf', 'docx']);
    expect(res.result.files[0].url).toMatch(/^https:\/\/drive\.google\.com\/file\/d\//);
  });

  it('replaces a same-named file instead of leaving a duplicate, and trashes the old one', () => {
    const h = createHarness();
    const first = h.call({ action: 'saveFiles', destination: 'pending', files: files() });
    const second = h.call({ action: 'saveFiles', destination: 'pending', files: files() });
    const live = h.drive.live(h.pendingFolder());
    expect(live).toHaveLength(2);
    expect(live.map((file) => file.id)).toEqual(second.result.files.map((file: { id: string }) => file.id));
    expect(h.drive.fileById.get(first.result.files[0].id)!.trashed).toBe(true);
  });

  it('creates the quarter folder once, then reuses it', () => {
    const h = createHarness();
    h.call({ action: 'saveFiles', destination: 'quarter', quarterFolderName: 'Q4 (Jan-Mar 2027)', files: files('a') });
    h.call({ action: 'saveFiles', destination: 'quarter', quarterFolderName: 'Q4 (Jan-Mar 2027)', files: files('b') });
    const quarters = h.rootFolder().folders.filter((folder) => folder.name.startsWith('Q'));
    expect(quarters.map((folder) => folder.name)).toEqual(['Q4 (Jan-Mar 2027)']);
    expect(h.drive.live(quarters[0])).toHaveLength(4);
  });

  it('moves an invoice out of Pending by trashing the earlier copies', () => {
    const h = createHarness();
    const pending = h.call({ action: 'saveFiles', destination: 'pending', files: files() });
    const ids = pending.result.files.map((file: { id: string }) => file.id);
    h.call({ action: 'saveFiles', destination: 'quarter', quarterFolderName: 'Q3 (Oct-Dec 2026)', files: files(), replaceIds: ids });
    expect(h.drive.live(h.pendingFolder())).toHaveLength(0);
    const quarter = h.rootFolder().folders.find((folder) => folder.name === 'Q3 (Oct-Dec 2026)')!;
    expect(h.drive.live(quarter)).toHaveLength(2);
    ids.forEach((id: string) => expect(h.drive.fileById.get(id)!.trashed).toBe(true));
  });

  it('never permanently deletes: replaced files are only trashed', () => {
    const h = createHarness();
    const first = h.call({ action: 'saveFiles', destination: 'pending', files: files() });
    h.call({ action: 'saveFiles', destination: 'pending', files: files() });
    expect(h.drive.fileById.has(first.result.files[0].id)).toBe(true);
  });

  it('ignores a replace id that no longer exists', () => {
    const h = createHarness();
    const res = h.call({ action: 'saveFiles', destination: 'pending', files: files(), replaceIds: ['file-does-not-exist'] });
    expect(res.ok).toBe(true);
  });

  it('requires files and a quarter folder name for a quarter save', () => {
    const h = createHarness();
    expect(h.call({ action: 'saveFiles', destination: 'pending', files: [] }).error).toMatch(/No files/);
    expect(h.call({ action: 'saveFiles', destination: 'quarter', files: files() }).error).toMatch(/quarter folder name/);
  });
});
