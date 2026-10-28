// Test helper: runs docs/drive-link/Code.gs unchanged, with an in-memory Google Drive and
// an in-memory copy of the master workbook (same headings, same formula cells).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export const TOKEN = 'test-token-0123456789-abcdefghij';
export const SHEET_ID = 'sheet-1';
export const INVOICE_ROOT_ID = '1DCSCEo3kgnetB481G4G_XCLg4YaScRDx';
export const PENDING_FOLDER_ID = '1bO7LQBh-HLbdJf0r9A8wjUnET0X5rVYv';

const SERIES_HEADERS = ['FY', 'Qtr (Period)', 'Month', 'Series', 'Serial', 'Doc No', 'Doc Date', 'Invoice Type', 'Client', 'Project', 'Place of Supply', 'Customer GSTIN', 'SAC', 'Supply Type', 'Tax Type', 'Tax Rate', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'GST Total', 'Round Off', 'Invoice Value', 'Received', 'Balance', 'Payment Status', 'Return Status', 'Filing Qtr', 'Source PDF (Drive Link)', 'Notes', 'Dup Flag'];
const PENDING_HEADERS = ['FY', 'Qtr (Period)', 'Month', 'Series', 'Serial', 'Reserved Doc No', 'Draft Date', 'Invoice Type', 'Client', 'Project', 'Place of Supply', 'Customer GSTIN', 'Taxable Value', 'GST Type', 'GST Amount', 'Gross Pending', 'Payment Status', 'Promotion Status', 'Drive Draft Link', 'Notes / Payment Promotion Checklist'];
const LEDGER_HEADERS = ['Payment Date', 'Client', 'Project', 'Doc No', 'Payment Type', 'Taxable Base', 'GST', 'Gross Received', 'Payment Mode', 'Status', 'Quarter', 'Reference / UTR', 'Source File'];

const letters = (index: number) => {
  let s = '';
  while (index > 0) {
    s = String.fromCharCode(65 + ((index - 1) % 26)) + s;
    index = Math.floor((index - 1) / 26);
  }
  return s;
};
const indexOf = (col: string) => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

export class FakeSheet {
  values = new Map<string, unknown>();
  formulas = new Map<string, string>();
  formats = new Map<string, string>();
  links = new Map<string, { text: string; url: string }>();
  constructor(readonly name: string) {}
  key = (row: number, col: number) => `${row},${col}`;
  cell(address: string) {
    const match = /^([A-Z]+)(\d+)$/.exec(address)!;
    return this.values.get(this.key(Number(match[2]), indexOf(match[1])));
  }
  put(address: string, value: unknown) {
    const match = /^([A-Z]+)(\d+)$/.exec(address)!;
    this.values.set(this.key(Number(match[2]), indexOf(match[1])), value);
  }
  setHeaders(row: number, headers: string[]) {
    headers.forEach((header, i) => this.values.set(this.key(row, i + 1), header));
  }
  // The API surface Code.gs uses.
  getRange = (row: number, col: number, numRows = 1, numCols = 1) => {
    return {
      getValues: () =>
        Array.from({ length: numRows }, (_, r) =>
          Array.from({ length: numCols }, (_, c) => this.values.get(this.key(row + r, col + c)) ?? ''),
        ),
      setValues: (rows: unknown[][]) => {
        rows.forEach((values, r) => values.forEach((value, c) => this.values.set(this.key(row + r, col + c), value)));
      },
      setValue: (value: unknown) => this.values.set(this.key(row, col), value),
      setNumberFormat: (format: string) => this.formats.set(this.key(row, col), format),
      setRichTextValue: (rich: { text: string; url: string }) => {
        this.links.set(this.key(row, col), rich);
        this.values.set(this.key(row, col), rich.text);
      },
    };
  };
}

class FakeFile {
  trashed = false;
  constructor(readonly id: string, public name: string, readonly bytes: number[], readonly mime: string, readonly folder: FakeFolder) {}
  getId = () => this.id;
  getName = () => this.name;
  getUrl = () => `https://drive.google.com/file/d/${this.id}/view`;
  setTrashed = (value: boolean) => {
    this.trashed = value;
    return this;
  };
}

class FakeFolder {
  files: FakeFile[] = [];
  folders: FakeFolder[] = [];
  constructor(readonly id: string, public name: string, private readonly drive: FakeDrive) {}
  parent: FakeFolder | null = null;
  getId = () => this.id;
  getName = () => this.name;
  getParents = () => iterator(this.parent ? [this.parent] : []);
  getFoldersByName = (name: string) => iterator(this.folders.filter((folder) => folder.name === name));
  createFolder = (name: string) => {
    const folder = new FakeFolder(this.drive.nextId('folder'), name, this.drive);
    folder.parent = this;
    this.folders.push(folder);
    this.drive.folderById.set(folder.id, folder);
    return folder;
  };
  getFilesByName = (name: string) => iterator(this.files.filter((file) => file.name === name && !file.trashed));
  createFile = (blob: { bytes: number[]; mime: string; name: string }) => {
    const file = new FakeFile(this.drive.nextId('file'), blob.name, blob.bytes, blob.mime, this);
    this.files.push(file);
    this.drive.fileById.set(file.id, file);
    return file;
  };
}

function iterator<T>(items: T[]) {
  let i = 0;
  return { hasNext: () => i < items.length, next: () => items[i++] };
}

class FakeDrive {
  folderById = new Map<string, FakeFolder>();
  fileById = new Map<string, FakeFile>();
  private counter = 0;
  nextId = (kind: string) => `${kind}-${++this.counter}`;
  constructor() {
    const root = new FolderFactory(this).make(INVOICE_ROOT_ID, '01 - GST Invoice PDFs');
    const pending = new FolderFactory(this).make(PENDING_FOLDER_ID, '00 - Pending GST Invoices');
    pending.parent = root;
    root.folders.push(pending);
    root.parent = new FolderFactory(this).make('data-room', 'Shotlin GST Master - CRM TEST');
    this.folderById.set(root.id, root);
    this.folderById.set(pending.id, pending);
    // An unrelated folder, standing in for another copy of the data room.
    this.folderById.set('other-copy-pending', new FolderFactory(this).make('other-copy-pending', '00 - Pending GST Invoices'));
  }
  live(folder: FakeFolder) {
    return folder.files.filter((file) => !file.trashed);
  }
}
class FolderFactory {
  constructor(private readonly drive: FakeDrive) {}
  make(id: string, name: string) {
    return new FakeFolder(id, name, this.drive);
  }
}

export type Harness = ReturnType<typeof createHarness>;

export function createHarness(
  options: { token?: string | null; sheetId?: string | null; rootId?: string | null; pendingId?: string | null } = {},
) {
  const props: Record<string, string> = {};
  if (options.token !== null) props.TOKEN = options.token ?? TOKEN;
  if (options.sheetId !== null) props.SHEET_ID = options.sheetId ?? SHEET_ID;
  if (options.rootId !== null) props.INVOICE_ROOT_ID = options.rootId ?? INVOICE_ROOT_ID;
  if (options.pendingId !== null) props.PENDING_FOLDER_ID = options.pendingId ?? PENDING_FOLDER_ID;

  const series = new FakeSheet('GST_Series');
  series.setHeaders(6, SERIES_HEADERS);
  const pending = new FakeSheet('GST_Pending');
  pending.setHeaders(7, PENDING_HEADERS);
  const ledger = new FakeSheet('Pay_Ledger');
  ledger.setHeaders(5, LEDGER_HEADERS);
  for (let row = 7; row <= 506; row++) {
    series.formulas.set(`${row},${indexOf('U')}`, `=SUM(R${row}:T${row})`);
    series.formulas.set(`${row},${indexOf('AE')}`, `=IF(COUNTIFS($D$7:D${row},D${row},$E$7:E${row},E${row})>1,"DUP","")`);
  }
  const sheets: Record<string, FakeSheet> = { GST_Series: series, GST_Pending: pending, Pay_Ledger: ledger };
  const drive = new FakeDrive();
  let lockHeld = false;

  const sandbox: Record<string, unknown> = {
    JSON,
    Date,
    Object,
    String,
    Number,
    Array,
    Error,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => props[key] ?? null }) },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          lockHeld = true;
        },
        releaseLock: () => {
          lockHeld = false;
        },
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text: string) => ({ getContent: () => text, setMimeType() { return this; } }),
    },
    Utilities: {
      base64Decode: (value: string) => [...Buffer.from(value, 'base64')],
      newBlob: (bytes: number[], mime: string, name: string) => ({ bytes, mime, name }),
    },
    DriveApp: {
      getFolderById: (id: string) => {
        const folder = drive.folderById.get(id);
        if (!folder) throw new Error('Folder not found: ' + id);
        return folder;
      },
      getFileById: (id: string) => {
        const file = drive.fileById.get(id);
        if (!file) throw new Error('File not found: ' + id);
        return file;
      },
    },
    SpreadsheetApp: {
      openById: (id: string) => {
        if (id !== SHEET_ID) throw new Error('Spreadsheet not found');
        return { getName: () => 'Shotlin GST Master - CRM TEST', getSheetByName: (name: string) => sheets[name] ?? null };
      },
      newRichTextValue: () => {
        const rich = { text: '', url: '' };
        const builder = {
          setText(text: string) {
            rich.text = text;
            return builder;
          },
          setLinkUrl(url: string) {
            rich.url = url;
            return builder;
          },
          build: () => rich,
        };
        return builder;
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.join(process.cwd(), 'docs/drive-link/Code.gs'), 'utf8'), sandbox);
  const script = sandbox as unknown as {
    doPost: (e: { postData: { contents: string } }) => { getContent: () => string };
    doGet: () => { getContent: () => string };
  };

  const call = (body: Record<string, unknown>, token: string | null = options.token ?? TOKEN) => {
    const out = script.doPost({ postData: { contents: JSON.stringify(token === null ? body : { token, ...body }) } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return JSON.parse(out.getContent()) as { ok: boolean; result?: any; error?: string };
  };

  return {
    call,
    callRaw: (contents: string) => JSON.parse(script.doPost({ postData: { contents } }).getContent()) as { ok: boolean; error?: string },
    get: () => JSON.parse(script.doGet().getContent()),
    sheets,
    series,
    pending,
    ledger,
    drive,
    lockHeld: () => lockHeld,
    pendingFolder: () => drive.folderById.get(PENDING_FOLDER_ID)!,
    rootFolder: () => drive.folderById.get(INVOICE_ROOT_ID)!,
    letters,
    indexOf,
  };
}
