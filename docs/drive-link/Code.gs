/**
 * Shotlin CRM <-> Google Drive / Sheets bridge.
 *
 * Runs inside YOUR Google account (free). The CRM calls it with a secret token to
 *   - save invoice PDF / Word files into the right Drive folder, and
 *   - add or update rows in the master workbook.
 *
 * Safety rules built in:
 *   - nothing happens without the token (kept in Script Properties, never in this file);
 *   - the sheet's column headings are checked before every write, and a mismatch stops it;
 *   - formula columns are never written;
 *   - files are only ever moved to the Trash (recoverable), never permanently deleted;
 *   - one write at a time (script lock).
 *
 * Setup is described in SETUP.md next to this file.
 */

// Everything that says WHERE to write lives in Script Properties, never in this file, and has no
// default. That way a test copy and the real data room can never be mixed up by accident:
//   TOKEN              the shared secret
//   SHEET_ID           the Google Sheet (the master workbook)
//   INVOICE_ROOT_ID    the folder "01 - GST Invoice PDFs" (quarter folders live inside it)
//   PENDING_FOLDER_ID  the folder "00 - Pending GST Invoices"
function prop_(name) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error('The ' + name + ' script property is not set.');
  return value;
}

var SERIES_HEADERS = ['FY', 'Qtr (Period)', 'Month', 'Series', 'Serial', 'Doc No', 'Doc Date', 'Invoice Type', 'Client', 'Project', 'Place of Supply', 'Customer GSTIN', 'SAC', 'Supply Type', 'Tax Type', 'Tax Rate', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'GST Total', 'Round Off', 'Invoice Value', 'Received', 'Balance', 'Payment Status', 'Return Status', 'Filing Qtr', 'Source PDF (Drive Link)', 'Notes', 'Dup Flag'];
var PENDING_HEADERS = ['FY', 'Qtr (Period)', 'Month', 'Series', 'Serial', 'Reserved Doc No', 'Draft Date', 'Invoice Type', 'Client', 'Project', 'Place of Supply', 'Customer GSTIN', 'Taxable Value', 'GST Type', 'GST Amount', 'Gross Pending', 'Payment Status', 'Promotion Status', 'Drive Draft Link', 'Notes / Payment Promotion Checklist'];
var LEDGER_HEADERS = ['Payment Date', 'Client', 'Project', 'Doc No', 'Payment Type', 'Taxable Base', 'GST', 'Gross Received', 'Payment Mode', 'Status', 'Quarter', 'Reference / UTR', 'Source File'];

var MONEY = '"₹"#,##0.00';
var SHEETS = {
  GST_Series: {
    headerRow: 6, firstRow: 7, lastRow: 506, keyCol: 'F', headers: SERIES_HEADERS,
    formulaCols: ['U', 'AE'],
    // Left alone once a row exists, because people maintain these by hand.
    insertOnly: ['AA', 'AD'],
    formats: { G: 'dd mmm yyyy', P: '0.0%', Q: MONEY, R: MONEY, S: MONEY, T: MONEY, V: MONEY, W: MONEY, X: MONEY, Y: MONEY },
  },
  GST_Pending: {
    headerRow: 7, firstRow: 8, lastRow: 107, keyCol: 'F', headers: PENDING_HEADERS,
    formulaCols: [], insertOnly: [],
    formats: { G: 'dd mmm yyyy', M: MONEY, O: MONEY, P: MONEY },
  },
  Pay_Ledger: {
    headerRow: 5, firstRow: 6, lastRow: 2000, keyCol: 'N', headers: LEDGER_HEADERS,
    // Column N is added by the CRM so every payment is written once, never twice.
    extraHeaders: { N: 'CRM Payment ID' },
    formulaCols: [], insertOnly: [],
    formats: { A: 'dd mmm yyyy', F: MONEY, G: MONEY, H: MONEY },
  },
};

// ---------------------------------------------------------------- run once from the editor

/**
 * Run this once from the Apps Script editor (Run button) after pasting the script.
 * Google asks you to approve access to Drive and Sheets the first time. The log then says
 * whether your folders and workbook were found and the column headings match.
 */
function testMySetup() {
  Logger.log(JSON.stringify(selfTest_(), null, 2));
}

// ---------------------------------------------------------------- web app entry

function doGet() {
  return json_({ ok: true, service: 'shotlin-drive-link' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    var request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    authorize_(request.token);
    lock.waitLock(30000);
    locked = true;
    var result;
    switch (request.action) {
      case 'selfTest': result = selfTest_(); break;
      case 'saveFiles': result = saveFiles_(request); break;
      case 'upsertRow': result = upsertRow_(request); break;
      default: throw new Error('Unknown action: ' + request.action);
    }
    return json_({ ok: true, result: result });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    if (locked) lock.releaseLock();
  }
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function authorize_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!expected || expected.length < 24) throw new Error('The TOKEN script property is not set (or too short).');
  if (typeof token !== 'string' || token.length !== expected.length) throw new Error('Not authorised');
  var diff = 0;
  for (var i = 0; i < expected.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) throw new Error('Not authorised');
}

function spreadsheet_() {
  return SpreadsheetApp.openById(prop_('SHEET_ID'));
}

// ---------------------------------------------------------------- column helpers

function colIndex_(letters) {
  var n = 0;
  for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n;
}

function colLetters_(index) {
  var s = '';
  while (index > 0) {
    var rem = (index - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    index = Math.floor((index - 1) / 26);
  }
  return s;
}

// ---------------------------------------------------------------- sheet safety

// Stops the script from writing into a sheet whose layout has changed.
function checkHeaders_(sheet, config, name) {
  var cells = sheet.getRange(config.headerRow, 1, 1, config.headers.length).getValues()[0];
  for (var i = 0; i < config.headers.length; i++) {
    if (String(cells[i]).trim() !== config.headers[i]) {
      throw new Error(name + ': column ' + colLetters_(i + 1) + ' should be "' + config.headers[i] + '" but is "' + String(cells[i]).trim() + '". Nothing was written.');
    }
  }
  var extras = config.extraHeaders || {};
  Object.keys(extras).forEach(function (letters) {
    var cell = sheet.getRange(config.headerRow, colIndex_(letters), 1, 1);
    var current = String(cell.getValues()[0][0]).trim();
    if (current === '') cell.setValue(extras[letters]);
    else if (current !== extras[letters]) throw new Error(name + ': column ' + letters + ' should be "' + extras[letters] + '" but is "' + current + '".');
  });
}

function sheetFor_(name) {
  var config = SHEETS[name];
  if (!config) throw new Error('Unknown sheet: ' + name);
  var sheet = spreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('The workbook has no tab named ' + name);
  checkHeaders_(sheet, config, name);
  return { sheet: sheet, config: config };
}

function selfTest_() {
  var report = { workbook: spreadsheet_().getName(), sheets: {}, folders: {} };
  Object.keys(SHEETS).forEach(function (name) {
    sheetFor_(name);
    report.sheets[name] = 'ok';
  });
  var root = DriveApp.getFolderById(prop_('INVOICE_ROOT_ID'));
  var pending = DriveApp.getFolderById(prop_('PENDING_FOLDER_ID'));
  report.folders.invoiceRoot = root.getName();
  report.folders.pending = pending.getName();
  // The names inside a test copy match the originals, so also show the data room they sit in.
  var rootParents = root.getParents();
  report.folders.dataRoom = rootParents.hasNext() ? rootParents.next().getName() : '(top level of My Drive)';
  // The quarter folders and the Pending folder must belong to the same copy of the data room.
  var inside = false;
  var parents = pending.getParents();
  while (parents.hasNext()) if (parents.next().getId() === root.getId()) inside = true;
  if (!inside) throw new Error('The Pending folder is not inside the invoice folder. Check INVOICE_ROOT_ID and PENDING_FOLDER_ID belong to the same copy.');
  report.folders.consistent = 'ok';
  return report;
}

// ---------------------------------------------------------------- rows

function toCellValue_(value) {
  if (value && typeof value === 'object' && typeof value.date === 'string') {
    var parts = value.date.split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }
  return value;
}

function findRow_(sheet, config) {
  var count = config.lastRow - config.firstRow + 1;
  return sheet.getRange(config.firstRow, colIndex_(config.keyCol), count, 1).getValues();
}

// Writes only the columns given, in contiguous groups, so formula columns in between are untouched.
function writeColumns_(sheet, row, columns) {
  var indexes = Object.keys(columns).map(colIndex_).sort(function (a, b) { return a - b; });
  var i = 0;
  while (i < indexes.length) {
    var start = indexes[i];
    var end = start;
    while (i + 1 < indexes.length && indexes[i + 1] === end + 1) { i++; end = indexes[i]; }
    var values = [[]];
    for (var c = start; c <= end; c++) values[0].push(toCellValue_(columns[colLetters_(c)]));
    sheet.getRange(row, start, 1, end - start + 1).setValues(values);
    i++;
  }
}

function upsertRow_(request) {
  var target = sheetFor_(request.sheet);
  var sheet = target.sheet;
  var config = target.config;
  var key = String(request.key || '').trim();
  if (!key) throw new Error('A row key is required.');

  var keys = findRow_(sheet, config);
  var found = -1;
  var firstEmpty = -1;
  for (var i = 0; i < keys.length; i++) {
    var cell = String(keys[i][0]).trim();
    if (cell === key) { found = i; break; }
    if (cell === '' && firstEmpty === -1) firstEmpty = i;
  }

  var created = false;
  var rowIndex;
  if (found >= 0) {
    rowIndex = config.firstRow + found;
  } else {
    if (request.onlyIfExists) return { found: false, created: false };
    if (firstEmpty === -1) throw new Error(request.sheet + ' has no empty rows left (rows ' + config.firstRow + '-' + config.lastRow + ').');
    rowIndex = config.firstRow + firstEmpty;
    created = true;
  }

  // Hand-maintained columns are only written on insert, unless the caller names them in `overwrite`.
  var overwrite = request.overwrite || [];
  var values = {};
  Object.keys(request.values || {}).forEach(function (letters) {
    if (config.formulaCols.indexOf(letters) >= 0) throw new Error('Column ' + letters + ' is a formula column and is never written.');
    if (!created && config.insertOnly.indexOf(letters) >= 0 && overwrite.indexOf(letters) < 0) return;
    values[letters] = request.values[letters];
  });
  // A note is added after what is already there, once, never replacing what a person wrote.
  var notes = request.appendNotes || {};
  Object.keys(notes).forEach(function (letters) {
    if (config.formulaCols.indexOf(letters) >= 0) throw new Error('Column ' + letters + ' is a formula column and is never written.');
    var current = created ? '' : String(sheet.getRange(rowIndex, colIndex_(letters), 1, 1).getValues()[0][0]).trim();
    var note = String(notes[letters]);
    if (current.indexOf(note) >= 0) return;
    values[letters] = current ? current + ' | ' + note : note;
  });
  // The key itself is always written, so a new row is found again next time.
  values[config.keyCol] = key;
  writeColumns_(sheet, rowIndex, values);

  Object.keys(values).forEach(function (letters) {
    var format = config.formats[letters];
    if (format) sheet.getRange(rowIndex, colIndex_(letters), 1, 1).setNumberFormat(format);
  });

  var links = request.links || {};
  Object.keys(links).forEach(function (letters) {
    if (!created && config.insertOnly.indexOf(letters) >= 0 && overwrite.indexOf(letters) < 0) return;
    var link = links[letters];
    var rich = SpreadsheetApp.newRichTextValue().setText(link.text).setLinkUrl(link.url).build();
    sheet.getRange(rowIndex, colIndex_(letters), 1, 1).setRichTextValue(rich);
  });

  return { found: !created, created: created, row: rowIndex };
}

// ---------------------------------------------------------------- Drive files

function quarterFolder_(name) {
  var root = DriveApp.getFolderById(prop_('INVOICE_ROOT_ID'));
  var matches = root.getFoldersByName(name);
  if (matches.hasNext()) return matches.next();
  return root.createFolder(name);
}

function saveFiles_(request) {
  if (!request.files || !request.files.length) throw new Error('No files were sent.');
  var folder = request.destination === 'pending'
    ? DriveApp.getFolderById(prop_('PENDING_FOLDER_ID'))
    : quarterFolder_(String(request.quarterFolderName || ''));
  if (request.destination !== 'pending' && !request.quarterFolderName) throw new Error('A quarter folder name is required.');

  var saved = [];
  request.files.forEach(function (file) {
    var bytes = Utilities.base64Decode(file.base64);
    var blob = Utilities.newBlob(bytes, file.mimeType, file.name);
    // An older copy with the same name in this folder is replaced (moved to the Trash).
    var same = folder.getFilesByName(file.name);
    var stale = [];
    while (same.hasNext()) stale.push(same.next());
    var created = folder.createFile(blob);
    stale.forEach(function (old) { old.setTrashed(true); });
    saved.push({ kind: file.kind, id: created.getId(), url: created.getUrl() });
  });

  // Files saved earlier in another folder (for example Pending, before it was paid) go to the Trash.
  (request.replaceIds || []).forEach(function (id) {
    if (saved.some(function (item) { return item.id === id; })) return;
    try { DriveApp.getFileById(id).setTrashed(true); } catch (err) { /* already gone */ }
  });

  return { folderId: folder.getId(), folderName: folder.getName(), files: saved };
}
