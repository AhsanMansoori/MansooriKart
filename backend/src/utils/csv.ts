import { CSV_LIMITS } from '../config/dropshipping.js';

/**
 * Bounded RFC 4180 CSV reader.
 *
 * Written rather than taken from a dependency because the requirement is narrow
 * and the safety properties matter more than features: every limit is checked
 * while scanning, so a hostile or malformed upload is rejected at the byte that
 * breaks a bound instead of after the whole file has been materialised into
 * objects. There is deliberately no XLSX, no auto-detected delimiter beyond the
 * three below, no type inference, and no evaluation of any cell.
 *
 * Parser internals never reach a client: callers translate `CsvFormatError.code`
 * into a stable API code and a human message of their own.
 */

export class CsvFormatError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly row?: number
  ) {
    super(message);
  }
}

export interface CsvRow {
  /** 1-based row number as a human counts them in a spreadsheet, header being row 1. */
  rowNumber: number;
  cells: string[];
}

export interface CsvDocument {
  headers: string[];
  rows: CsvRow[];
  /** Rows present in the file beyond `CSV_LIMITS.maxRows`, if the caller asked to stop early. */
  truncated: boolean;
}

const BOM = '﻿';

/** Rejects bytes that cannot be a text CSV: NUL and stray control characters imply a binary upload. */
function assertTextual(input: Buffer): void {
  const sample = input.subarray(0, Math.min(input.length, 8192));
  for (const byte of sample) {
    if (byte === 0) throw new CsvFormatError('CSV_NOT_TEXT', 'The uploaded file is not a text CSV file.');
    // Allow tab (9), newline (10), carriage return (13); reject other C0 controls.
    if (byte < 9 || (byte > 13 && byte < 32)) throw new CsvFormatError('CSV_NOT_TEXT', 'The uploaded file is not a text CSV file.');
  }
}

/** Picks the delimiter by counting candidates outside quotes on the header line only. */
function detectDelimiter(headerLine: string): string {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = -1;
  for (const candidate of candidates) {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < headerLine.length; index += 1) {
      const character = headerLine[index];
      if (character === '"') quoted = !quoted;
      else if (!quoted && character === candidate) count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

/** Reads the first physical line, respecting quoted newlines, so the delimiter scan is accurate. */
function firstLogicalLine(text: string): string {
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') quoted = !quoted;
    else if (!quoted && (character === '\n' || character === '\r')) return text.slice(0, index);
  }
  return text;
}

/**
 * Parses `input` into a header row plus bounded data rows.
 *
 * `maxRows` rows are read and any further rows set `truncated`, so a caller that
 * only needs a preview never pays for the whole file. Row-level problems that a
 * caller can report per row (a wrong cell count) are returned as data; structural
 * problems that make the file unreadable (an unterminated quote, an empty file,
 * duplicate headers) throw.
 */
export function parseCsv(input: Buffer | string, options: { maxRows?: number } = {}): CsvDocument {
  const maxRows = options.maxRows ?? CSV_LIMITS.maxRows;
  if (Buffer.isBuffer(input)) {
    if (input.length === 0) throw new CsvFormatError('CSV_EMPTY', 'The uploaded file is empty.');
    if (input.length > CSV_LIMITS.maxFileBytes) throw new CsvFormatError('CSV_TOO_LARGE', 'The uploaded file is larger than the import limit.');
    assertTextual(input);
  }
  let text = Buffer.isBuffer(input) ? input.toString('utf8') : input;
  if (text.startsWith(BOM)) text = text.slice(BOM.length);
  if (!text.trim()) throw new CsvFormatError('CSV_EMPTY', 'The uploaded file is empty.');
  // A replacement character means the bytes were not valid UTF-8; a supplier feed
  // in another encoding must be converted before upload rather than corrupted here.
  if (text.includes('�')) throw new CsvFormatError('CSV_ENCODING_INVALID', 'The uploaded file is not valid UTF-8 text.');

  const delimiter = detectDelimiter(firstLogicalLine(text));
  const headers: string[] = [];
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let rowNumber = 1;
  let truncated = false;
  let sawAnyCharacterInRow = false;

  const finishField = () => {
    if (field.length > CSV_LIMITS.maxFieldLength)
      throw new CsvFormatError('CSV_FIELD_TOO_LONG', 'A cell in the uploaded file exceeds the maximum length.', rowNumber);
    cells.push(field);
    field = '';
  };
  const finishRow = (): boolean => {
    finishField();
    const isBlank = cells.length === 1 && cells[0]!.trim() === '';
    if (headers.length === 0) {
      if (isBlank) {
        cells = [];
        sawAnyCharacterInRow = false;
        return true;
      }
      if (cells.length > CSV_LIMITS.maxColumns) throw new CsvFormatError('CSV_TOO_MANY_COLUMNS', 'The uploaded file has too many columns.');
      for (const header of cells) {
        if (header.length > CSV_LIMITS.maxHeaderLength) throw new CsvFormatError('CSV_HEADER_TOO_LONG', 'A column header exceeds the maximum length.');
      }
      const normalized = cells.map(header => header.trim());
      if (normalized.every(header => header === '')) throw new CsvFormatError('CSV_HEADER_MISSING', 'The uploaded file has no usable header row.');
      if (normalized.some(header => header === '')) throw new CsvFormatError('CSV_HEADER_BLANK', 'The uploaded file has a blank column header.');
      const seen = new Set<string>();
      for (const header of normalized) {
        const key = header.toLowerCase();
        if (seen.has(key)) throw new CsvFormatError('CSV_HEADER_DUPLICATE', `The uploaded file has a duplicate column header: ${header}`);
        seen.add(key);
      }
      headers.push(...normalized);
    } else if (!isBlank) {
      if (rows.length >= maxRows) {
        truncated = true;
        cells = [];
        sawAnyCharacterInRow = false;
        return false;
      }
      rows.push({ rowNumber, cells });
    }
    cells = [];
    sawAnyCharacterInRow = false;
    rowNumber += 1;
    return true;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    sawAnyCharacterInRow = true;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += character;
      continue;
    }
    if (character === '"') {
      // A quote may only open a field. Mid-field quotes indicate a broken feed.
      if (field.length > 0) throw new CsvFormatError('CSV_QUOTE_INVALID', 'A quoted value in the uploaded file is malformed.', rowNumber);
      quoted = true;
      continue;
    }
    if (character === delimiter) {
      finishField();
      continue;
    }
    if (character === '\r') {
      if (text[index + 1] === '\n') index += 1;
      if (!finishRow()) break;
      continue;
    }
    if (character === '\n') {
      if (!finishRow()) break;
      continue;
    }
    field += character;
  }
  if (quoted) throw new CsvFormatError('CSV_QUOTE_UNTERMINATED', 'A quoted value in the uploaded file is never closed.', rowNumber);
  if (!truncated && (sawAnyCharacterInRow || field.length > 0 || cells.length > 0)) finishRow();
  if (headers.length === 0) throw new CsvFormatError('CSV_HEADER_MISSING', 'The uploaded file has no usable header row.');
  if (rows.length === 0 && !truncated) throw new CsvFormatError('CSV_NO_DATA_ROWS', 'The uploaded file contains a header but no data rows.');
  return { headers, rows, truncated };
}

/**
 * Neutralises spreadsheet formula injection for any value MansooriKart writes back
 * into a CSV or spreadsheet context. A leading `=`, `+`, `-`, `@`, tab or carriage
 * return is what Excel and Sheets treat as the start of a formula, so the value is
 * prefixed with an apostrophe and kept as text. Stored data is never mangled by
 * this; it applies only at export.
 */
export function csvSafeValue(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** Quotes a single cell for CSV output after formula-injection neutralisation. */
export function csvCell(value: unknown): string {
  const safe = csvSafeValue(value);
  return /["\n\r,;\t]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
