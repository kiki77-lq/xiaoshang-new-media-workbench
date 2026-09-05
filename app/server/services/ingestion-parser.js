import { inflateRawSync } from 'node:zlib';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { assertObject, enumValue, requiredString } from './validation.js';
import { DEFAULT_MAPPING, ROW_FIELDS, LIMITS, blank, invalid, period } from './metric-model.js';

export function validateIngestion(input) {
  assertObject(input, ['sourceType','sourceName','periodStart','periodEnd','mapping','defaults','csvText','fileBase64','rows']);
  const sourceType = enumValue(input.sourceType, 'sourceType', ['manual','csv','excel','workbuddy']);
  const sourceName = requiredString(input.sourceName, 'sourceName', 240);
  const dates = period(input.periodStart, input.periodEnd);
  const tabular = ['csv','excel'].includes(sourceType);
  const field = tabular ? (sourceType === 'csv' ? 'csvText' : 'fileBase64') : 'rows';
  for (const other of ['rows','csvText','fileBase64']) {
    if (other !== field && Object.hasOwn(input, other)) invalid(`${other} is not allowed for ${sourceType}.`);
  }
  if (!tabular && (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > LIMITS.rows)) {
    invalid('rows must contain 1–1000 records.');
  }
  if (tabular && (typeof input[field] !== 'string' || !input[field].length)) invalid(`${field} is required.`);
  if (input.mapping !== undefined) {
    if (!tabular) invalid('mapping is only available for CSV/Excel.');
    assertObject(input.mapping, Object.keys(input.mapping ?? {}));
    if (Object.keys(input.mapping).length > LIMITS.columns) invalid('mapping has too many columns.');
    for (const [header, target] of Object.entries(input.mapping)) {
      requiredString(header, 'mapping header', 240);
      if (!ROW_FIELDS.includes(target)) invalid('mapping target must be a canonical row field.');
    }
  }
  const defaults = {};
  if (input.defaults !== undefined) {
    if (!tabular) invalid('defaults is only available for CSV/Excel.');
    assertObject(input.defaults, ['platformCode','contentId']);
    for (const key of ['platformCode','contentId']) {
      if (!blank(input.defaults[key])) defaults[key] = requiredString(input.defaults[key], key, 240);
    }
  }
  return { sourceType, sourceName, ...dates, mapping: input.mapping ?? {}, defaults, input };
}

// Inspect and bounded-inflate every ZIP entry before SheetJS. Do not trust advertised
// uncompressed sizes alone: a malicious archive may lie about them.
function inspectExtra(buffer, start, length) {
  const end = start + length;
  if (end > buffer.length) invalid('Excel ZIP extra field is out of bounds.');
  while (start < end) {
    if (start + 4 > end) invalid('Excel ZIP extra field is truncated.');
    const type = buffer.readUInt16LE(start), size = buffer.readUInt16LE(start + 2);
    // SheetJS lets ZIP64 hints override sizes from both directory and local headers.
    // This bounded importer has no reason to accept multi-gigabyte ZIP64 entries.
    if (type === 1) invalid('ZIP64 Excel archives are not supported.');
    start += 4 + size;
    if (start > end) invalid('Excel ZIP extra field exceeds its bounds.');
  }
}
function inspectZip(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  }
  if (end < 0 || buffer.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06])) !== end) invalid('Excel ZIP directory is invalid.');
  const count = buffer.readUInt16LE(end + 10);
  const directorySize = buffer.readUInt32LE(end + 12);
  const directoryStart = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || count < 1 || count > 256
    || buffer.readUInt16LE(end + 8) !== count || directoryStart + directorySize !== end) invalid('Unsupported Excel ZIP structure.');
  let offset = directoryStart, total = 0;
  const names = new Set();
  for (let n = 0; n < count; n++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) invalid('Excel ZIP entry is invalid.');
    const flags = buffer.readUInt16LE(offset + 8), method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20), expanded = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32), local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (flags & 0x2041 || ![0,8].includes(method) || total + expanded > LIMITS.uncompressed
      || local + 30 > directoryStart || buffer.readUInt32LE(local) !== 0x04034b50
      || buffer.readUInt16LE(local + 6) !== flags || buffer.readUInt16LE(local + 8) !== method
      || names.has(name)) invalid('Excel archive exceeds limits or has unsupported entries.');
    names.add(name);
    const localNameLength = buffer.readUInt16LE(local + 26);
    if (buffer.subarray(local + 30, local + 30 + localNameLength).toString('utf8') !== name) invalid('Excel ZIP names disagree.');
    const localExtraLength = buffer.readUInt16LE(local + 28);
    const localCompressed = buffer.readUInt32LE(local + 18), localExpanded = buffer.readUInt32LE(local + 22);
    if ((localCompressed !== compressed && !(flags & 8 && localCompressed === 0))
      || (localExpanded !== expanded && !(flags & 8 && localExpanded === 0))) invalid('Excel ZIP local size hints disagree with bounded directory.');
    inspectExtra(buffer,offset + 46 + nameLength,extraLength);
    inspectExtra(buffer,local + 30 + localNameLength,localExtraLength);
    const dataStart = local + 30 + localNameLength + localExtraLength;
    if (dataStart + compressed > directoryStart) invalid('Excel ZIP data range is invalid.');
    const bytes = buffer.subarray(dataStart, dataStart + compressed);
    const unpacked = method === 0 ? bytes : inflateRawSync(bytes, { maxOutputLength: Math.max(1, LIMITS.uncompressed - total) });
    if (unpacked.length !== expanded) invalid('Excel ZIP expanded size mismatch.');
    total += unpacked.length;
    if (total > LIMITS.uncompressed) invalid('Excel expanded size exceeds 16 MiB.');
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== end) invalid('Excel ZIP directory size mismatch.');
}

function excelRows(fileBase64) {
  if (fileBase64.length > Math.ceil(LIMITS.bytes / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(fileBase64)) invalid('Excel base64 is invalid or exceeds 1 MiB.');
  const buffer = Buffer.from(fileBase64, 'base64');
  if (!buffer.length || buffer.length > LIMITS.bytes) invalid('Excel file exceeds 1 MiB.');
  const zip = buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
  const ole = buffer.subarray(0,8).toString('hex') === 'd0cf11e0a1b11ae1';
  if (!zip && !ole) invalid('Excel supports .xlsx and .xls workbooks only.');
  if (zip) inspectZip(buffer);
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, cellFormula: true, sheetRows: LIMITS.rows + 2 });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet?.['!ref']) invalid('Excel first worksheet is empty.');
  const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
  if (range.e.r > LIMITS.rows || range.e.c >= LIMITS.columns
    || (range.e.r + 1) * (range.e.c + 1) > (LIMITS.rows + 1) * LIMITS.columns) invalid('Excel worksheet exceeds row/cell limits.');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true, range: 0 });
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith('!')) continue;
    const { r, c } = XLSX.utils.decode_cell(address);
    if (cell.f || cell.t === 'e') {
      // A cell error/formula rejects its own row, not other records.
      rows[r] ??= [];
      rows[r][c] = { invalidCell: true };
    }
  }
  return rows;
}

function tabularRows(matrix, mapping, defaults) {
  if (!matrix.length) invalid('Import is empty.');
  const headers = matrix[0];
  if (headers.length < 1 || headers.length > LIMITS.columns) invalid('Import exceeds column limits.');
  const effective = { ...DEFAULT_MAPPING, ...mapping };
  const canonical = headers.map(header => {
    const name = requiredString(header, 'header', 240);
    if (!Object.hasOwn(effective, name)) invalid(`Unknown column: ${name}.`);
    return effective[name];
  });
  if (new Set(canonical).size !== canonical.length) invalid('Duplicate mapped columns.');
  const records = [];
  for (let index = 1; index < matrix.length; index++) {
    const cells = matrix[index];
    if (cells.every(blank)) continue;
    if (records.length >= LIMITS.rows) invalid('Import exceeds 1000 rows.');
    try {
      if (cells.length !== canonical.length) invalid('Row cell count must match headers; use explicit empty fields for missing values.');
      const row = { ...defaults };
      canonical.forEach((key, column) => {
        const value = cells[column];
        if (blank(value)) return;
        if (typeof value === 'object' || typeof value === 'boolean') invalid('Unsupported Excel cell type or formula.');
        if (String(value).length > LIMITS.cell) invalid('Cell exceeds size limit.');
        row[key] = ['metrics','series','review'].includes(key) ? JSON.parse(value) : value;
      });
      records.push({ row, line: index + 1 });
    } catch (error) { records.push({ error: error.message, line: index + 1 }); }
  }
  if (!records.length) invalid('Import has no data rows.');
  return records;
}

export function parseIngestion(request) {
  const { sourceType, input, mapping, defaults } = request;
  if (sourceType === 'manual' || sourceType === 'workbuddy') return input.rows.map((row, index) => ({ row, line: index + 1 }));
  if (sourceType === 'excel') return tabularRows(excelRows(input.fileBase64), mapping, defaults);
  if (Buffer.byteLength(input.csvText) > LIMITS.bytes) invalid('CSV exceeds 1 MiB.');
  const matrix = parse(input.csvText, { bom: true, skip_empty_lines: true, relax_column_count: true,
    max_record_size: LIMITS.cell, trim: true });
  return tabularRows(matrix, mapping, defaults);
}
