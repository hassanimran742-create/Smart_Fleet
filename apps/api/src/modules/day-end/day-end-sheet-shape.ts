import { DAY_SHEET_LIMITS } from '@smartfleet/shared-types';
import { inspectZip, type ZipCheck } from './day-end-zip';

/**
 * [Inc 3] The upload's shape check (API_CONTRACT §10.2 check 3), run in the same pass as the ZIP check and
 * before exceljs reads a byte. exceljs 4.4.0 builds an object for every cell and row it reads, and expands
 * every data validation, merged range and defined name cell by cell, synchronously: a few-KB file with a
 * dropdown over the whole sheet, many merged cells or a name over whole columns used to stall the one API
 * instance (ADR-23) for minutes or run it out of memory. Here every part exceljs parses as XML is scanned
 * once, without building anything, and a workbook beyond the day-end sheet's shape is refused:
 *
 * - at most 8 sheets, 20,000 rows on a sheet (no row numbered past 20,000) and 60,000 rows in all;
 * - at most 200,000 cells (`DAY_SHEET_LIMITS.maxCells`) and 200,000 shared strings in all;
 * - every merged range, data validation, conditional format, defined name and declared sheet dimension
 *   within rows 1–20,000; at most 1,000 of each kind; at most 10,000 merged cells, and at most 200,000
 *   cells covered by each of the other kinds;
 * - column numbers within Excel's 16,384;
 * - at most 1,000,000 XML elements in all, and 100,000 in any part other than a sheet or the shared strings;
 * - no DOCTYPE (a workbook part never has one).
 *
 * The documented-maximum sheet (19,999 cylinder rows and 200 extra rows, every row filled) has 140,613
 * cells, 10.7 MB unzipped and about 385,000 elements; exceljs loads it in about 0.7 s with a heap peak of
 * about 90 MB. A real 35-cylinder sheet is about 10 KB with 265 cells. Every refusal is the same 422
 * `DAY_SHEET_UNREADABLE`; the reason returned is for the logs only.
 */
export const DAY_SHEET_SHAPE = {
  maxSheets: 8,
  maxRowsPerSheet: DAY_SHEET_LIMITS.maxRowsPerSheet,
  maxRows: 3 * DAY_SHEET_LIMITS.maxRowsPerSheet,
  maxCells: DAY_SHEET_LIMITS.maxCells,
  maxSharedStrings: DAY_SHEET_LIMITS.maxCells,
  maxColumn: 16_384,
  maxRangesPerKind: 1_000,
  maxMergedCells: 10_000,
  maxCoveredCells: DAY_SHEET_LIMITS.maxCells,
  maxElements: 1_000_000,
  maxElementsPerPart: 100_000,
} as const;

export type DaySheetShapeLimits = { readonly [K in keyof typeof DAY_SHEET_SHAPE]: number };

/** The ZIP check and the shape check in one pass over the upload: what the upload runs before exceljs. */
export function inspectDayUpload(bytes: Buffer, limits: DaySheetShapeLimits = DAY_SHEET_SHAPE): ZipCheck {
  const shape = new ShapeScan(limits);
  return inspectZip(bytes, { maxUnzippedBytes: DAY_SHEET_LIMITS.maxUnzippedBytes }, (name, data) => shape.visit(name, data));
}

// ---------- which parts exceljs parses ----------

type PartKind = 'worksheet' | 'workbook' | 'sharedStrings' | 'other' | 'skip';

/** exceljs 4.4.0's own dispatch (xlsx.js `load`), in its order: its patterns aren't anchored. */
const OTHER_PARTS = [
  /xl\/worksheets\/_rels\/sheet(\d+)[.]xml.rels/,
  /xl\/drawings\/([a-zA-Z0-9]+)[.]xml/,
  /xl\/(comments\d+)[.]xml/,
  /xl\/tables\/(table\d+)[.]xml/,
  /xl\/drawings\/_rels\/([a-zA-Z0-9]+)[.]xml[.]rels/,
  /xl\/drawings\/(vmlDrawing\d+)[.]vml/,
];

function partKind(resolved: string): PartKind {
  const name = resolved.startsWith('/') ? resolved.slice(1) : resolved;
  if (name.endsWith('/')) return 'skip'; // a folder
  switch (name) {
    case 'xl/workbook.xml':
      return 'workbook';
    case 'xl/sharedStrings.xml':
      return 'sharedStrings';
    case '_rels/.rels':
    case 'xl/_rels/workbook.xml.rels':
    case 'xl/styles.xml':
    case 'docProps/app.xml':
    case 'docProps/core.xml':
      return 'other';
    default:
      if (/xl\/worksheets\/sheet(\d+)[.]xml/.test(name)) return 'worksheet';
      if (OTHER_PARTS[0].test(name)) return 'other';
      // Themes are kept as text and media as bytes; neither is parsed.
      if (/xl\/theme\/([a-zA-Z0-9]+)[.]xml/.test(name) || /xl\/media\/([a-zA-Z0-9]+[.][a-zA-Z0-9]{3,4})$/.test(name)) return 'skip';
      return OTHER_PARTS.slice(1).some((pattern) => pattern.test(name)) ? 'other' : 'skip';
  }
}

// ---------- the scan ----------

const LT = 0x3c;
const GT = 0x3e;
const SLASH = 0x2f;
const BANG = 0x21;
const QUESTION = 0x3f;
const COLON = 0x3a;
const EQUALS = 0x3d;
const DOUBLE_QUOTE = 0x22;
const SINGLE_QUOTE = 0x27;

const COMMENT_OPEN = Buffer.from('<!--', 'latin1');
const CDATA_OPEN = Buffer.from('<![CDATA[', 'latin1');

/** True when `data` holds `bytes` at `at`. */
function bytesAt(data: Buffer, at: number, bytes: Buffer): boolean {
  return at + bytes.length <= data.length && data.compare(bytes, 0, bytes.length, at, at + bytes.length) === 0;
}

function isSpace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

/** Where an element name ends: a space, "/", ">" (or another "<", for broken markup). */
function isNameEnd(byte: number): boolean {
  return isSpace(byte) || byte === SLASH || byte === GT || byte === LT;
}

/** "A1", "$A$1", "A1:B2", "Cylinders!$A$1:$G$20000": every cell or range a text names (any letter case). */
const CELL_RANGE = /\$?([A-Za-z]{1,3})\$?(\d+)(?:\s*:\s*\$?([A-Za-z]{1,3})\$?(\d+))?/g;

function columnNumber(letters: string): number {
  let n = 0;
  for (const char of letters.toUpperCase()) n = n * 26 + (char.charCodeAt(0) - 64);
  return n;
}

const NAMED_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** XML character references and the five predefined entities, as the XML parser reads them. */
function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (match, ref: string) => {
    if (ref[0] !== '#') return NAMED_ENTITIES[ref] ?? match;
    const code = ref[1] === 'x' ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** Like `parseInt(value, 10)`, which exceljs uses for row numbers and column spans. */
function wholeNumber(value: string | null): number {
  if (value === null) return 0;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

type RangeKind = 'merge' | 'validation' | 'format' | 'name' | 'dimension';

class ShapeScan {
  private sheets = 0;
  private rows = 0;
  private cells = 0;
  private strings = 0;
  private elements = 0;
  private readonly ranges: Record<RangeKind, { count: number; cells: number }> = {
    merge: { count: 0, cells: 0 },
    validation: { count: 0, cells: 0 },
    format: { count: 0, cells: 0 },
    name: { count: 0, cells: 0 },
    dimension: { count: 0, cells: 0 },
  };

  constructor(private readonly limits: DaySheetShapeLimits) {}

  visit(name: string, data: Buffer): string | null {
    const kind = partKind(name);
    if (kind === 'skip') return null;
    if (kind === 'worksheet' && ++this.sheets > this.limits.maxSheets) return `more than ${this.limits.maxSheets} sheets`;
    return this.scanPart(data, kind);
  }

  private scanPart(data: Buffer, kind: Exclude<PartKind, 'skip'>): string | null {
    const sheet = kind === 'worksheet';
    let rowsHere = 0;
    let elementsHere = 0;
    // An x14 validation or conditional format keeps its ranges in a child <xm:sqref> element.
    let sqrefKind: RangeKind = 'validation';
    let at = data.indexOf(LT);
    while (at !== -1) {
      const next = data[at + 1];
      if (next === SLASH) {
        at = data.indexOf(LT, at + 2);
        continue;
      }
      if (next === QUESTION) {
        const close = data.indexOf('?>', at + 2, 'latin1');
        if (close < 0) return 'unclosed processing instruction';
        at = data.indexOf(LT, close + 2);
        continue;
      }
      if (next === BANG) {
        if (bytesAt(data, at, COMMENT_OPEN)) {
          const close = data.indexOf('-->', at + 4, 'latin1');
          if (close < 0) return 'unclosed comment';
          at = data.indexOf(LT, close + 3);
          continue;
        }
        if (bytesAt(data, at, CDATA_OPEN)) {
          const close = data.indexOf(']]>', at + 9, 'latin1');
          if (close < 0) return 'unclosed CDATA';
          at = data.indexOf(LT, close + 3);
          continue;
        }
        return 'DOCTYPE or other declaration';
      }
      let nameEnd = at + 1;
      while (nameEnd < data.length && !isNameEnd(data[nameEnd])) nameEnd++;
      if (nameEnd === at + 1) {
        // A stray "<" (not well-formed: the XML parser refuses it).
        at = data.indexOf(LT, at + 1);
        continue;
      }
      if (++this.elements > this.limits.maxElements) return `more than ${this.limits.maxElements} XML elements`;
      if (!sheet && kind !== 'sharedStrings' && ++elementsHere > this.limits.maxElementsPerPart) {
        return `more than ${this.limits.maxElementsPerPart} XML elements in one part`;
      }
      // The local name: after the last ":" of the qualified name.
      let localStart = at + 1;
      for (let i = nameEnd - 1; i > at; i--) {
        if (data[i] === COLON) {
          localStart = i + 1;
          break;
        }
      }
      const localLength = nameEnd - localStart;
      if (localLength === 1) {
        if (sheet && data[localStart] === 0x63 /* c */ && ++this.cells > this.limits.maxCells) return `more than ${this.limits.maxCells} cells`;
      } else if (localLength === 2) {
        if (kind === 'sharedStrings' && data[localStart] === 0x73 /* s */ && data[localStart + 1] === 0x69 /* i */) {
          if (++this.strings > this.limits.maxSharedStrings) return `more than ${this.limits.maxSharedStrings} shared strings`;
        }
      } else if (localLength >= 3 && localLength <= 21 && (sheet || kind === 'workbook')) {
        const local = data.toString('latin1', localStart, nameEnd);
        const refused = sheet ? this.sheetElement(data, local, at, nameEnd, () => ++rowsHere, (k) => (sqrefKind = k), sqrefKind) : null;
        if (refused) return refused;
        if (kind === 'workbook' && local === 'definedName') {
          const text = elementText(data, at, nameEnd);
          if (text === null) return 'unclosed defined name';
          const why = this.addRanges('name', text, true);
          if (why) return why;
        }
      }
      at = data.indexOf(LT, nameEnd);
    }
    return null;
  }

  /** The worksheet elements whose numbers or ranges exceljs acts on. */
  private sheetElement(
    data: Buffer,
    local: string,
    open: number,
    nameEnd: number,
    countRow: () => number,
    setSqrefKind: (kind: RangeKind) => void,
    sqrefKind: RangeKind,
  ): string | null {
    const max = this.limits;
    switch (local) {
      case 'row': {
        if (countRow() > max.maxRowsPerSheet) return `more than ${max.maxRowsPerSheet} rows on a sheet`;
        if (++this.rows > max.maxRows) return `more than ${max.maxRows} rows in all`;
        if (wholeNumber(attribute(data, nameEnd, 'r')) > max.maxRowsPerSheet) return `a row past row ${max.maxRowsPerSheet}`;
        return null;
      }
      case 'col': {
        const min = wholeNumber(attribute(data, nameEnd, 'min'));
        const last = wholeNumber(attribute(data, nameEnd, 'max'));
        return min > max.maxColumn || last > max.maxColumn ? 'a column past XFD' : null;
      }
      case 'dimension':
        return this.addRanges('dimension', attribute(data, nameEnd, 'ref'), false);
      case 'mergeCell':
        return this.addRanges('merge', attribute(data, nameEnd, 'ref'), false);
      case 'dataValidation':
      case 'conditionalFormatting': {
        const kind: RangeKind = local === 'dataValidation' ? 'validation' : 'format';
        setSqrefKind(kind);
        const sqref = attribute(data, nameEnd, 'sqref');
        return sqref === null ? null : this.addRanges(kind, sqref, false);
      }
      case 'sqref': {
        const text = elementText(data, open, nameEnd);
        if (text === null) return 'unclosed sqref';
        return this.addRanges(sqrefKind, text, false);
      }
      default:
        return null;
    }
  }

  /**
   * Adds the cells and ranges a text names to `kind`'s totals. A defined name counts once (`perText`);
   * every other range counts on its own.
   */
  private addRanges(kind: RangeKind, text: string | null, perText: boolean): string | null {
    if (text === null) return null;
    const max = this.limits;
    const totals = this.ranges[kind];
    let found = 0;
    for (const match of decodeEntities(text).matchAll(CELL_RANGE)) {
      const top = Number(match[2]);
      const bottom = match[4] === undefined ? top : Number(match[4]);
      if (Math.max(top, bottom) > max.maxRowsPerSheet) return `a ${kind} range past row ${max.maxRowsPerSheet}`;
      const left = columnNumber(match[1]);
      const right = match[3] === undefined ? left : columnNumber(match[3]);
      totals.cells += (Math.abs(bottom - top) + 1) * (Math.abs(right - left) + 1);
      found += 1;
    }
    totals.count += perText ? 1 : found;
    if (totals.count > max.maxRangesPerKind) return `more than ${max.maxRangesPerKind} ${kind} ranges`;
    const cellCap = kind === 'merge' ? max.maxMergedCells : kind === 'dimension' ? Number.POSITIVE_INFINITY : max.maxCoveredCells;
    if (totals.cells > cellCap) return `${kind} ranges cover more than ${cellCap} cells`;
    return null;
  }
}

/**
 * One attribute of the start tag whose name ends at `from`, entities left in (null when absent). Quoted
 * values may hold ">" and "/", so the tag is read attribute by attribute.
 */
function attribute(data: Buffer, from: number, wanted: string): string | null {
  let i = from;
  while (i < data.length) {
    while (i < data.length && isSpace(data[i])) i++;
    if (i >= data.length || data[i] === GT || data[i] === SLASH || data[i] === LT) return null;
    const nameStart = i;
    while (i < data.length && data[i] !== EQUALS && !isSpace(data[i]) && data[i] !== GT && data[i] !== SLASH) i++;
    const name = data.toString('latin1', nameStart, i);
    while (i < data.length && isSpace(data[i])) i++;
    if (data[i] !== EQUALS) return null; // not well-formed
    i++;
    while (i < data.length && isSpace(data[i])) i++;
    const quote = data[i];
    if (quote !== DOUBLE_QUOTE && quote !== SINGLE_QUOTE) return null;
    const close = data.indexOf(quote, i + 1);
    if (close < 0) return null;
    if (name === wanted) return data.toString('utf8', i + 1, close);
    i = close + 1;
  }
  return null;
}

/**
 * The text inside the element whose start tag opens at `open` (its name ends at `nameEnd`): every child
 * tag, comment and CDATA marker dropped, so a range split around them still reads as one. Null when the
 * element isn't closed; "" for an empty element.
 */
function elementText(data: Buffer, open: number, nameEnd: number): string | null {
  // The start tag's end, past quoted attribute values.
  let i = nameEnd;
  let quote = 0;
  for (; i < data.length; i++) {
    const byte = data[i];
    if (quote) {
      if (byte === quote) quote = 0;
    } else if (byte === DOUBLE_QUOTE || byte === SINGLE_QUOTE) {
      quote = byte;
    } else if (byte === GT) {
      break;
    }
  }
  if (i >= data.length) return null;
  if (data[i - 1] === SLASH) return '';
  const qname = data.toString('latin1', open + 1, nameEnd);
  const close = data.indexOf(`</${qname}`, i + 1, 'latin1');
  if (close < 0) return null;
  return data
    .toString('utf8', i + 1, close)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '');
}
