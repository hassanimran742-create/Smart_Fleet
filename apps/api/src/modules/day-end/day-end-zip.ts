import { inflateRawSync } from 'zlib';

/**
 * [Inc 3] The upload's file check before any spreadsheet code reads it (API_CONTRACT §10.2 check 3):
 * the bytes start with the ZIP signature `PK\x03\x04`, and the archive unzips to at most `maxUnzippedBytes`
 * in total. Every entry is really inflated, with a hard output cap, so a "zip bomb" whose headers lie
 * about its sizes is caught here and never reaches exceljs (which inflates every entry in memory).
 *
 * The archive must also read the same way here and in JSZip (what exceljs opens it with), so what is
 * checked is what exceljs gets: the central directory ends right where its end record starts (JSZip
 * shifts every offset by any gap) and holds exactly the entries the end record counts, each entry's
 * name is plain ASCII and the same in its local header (the one JSZip uses) and in the directory, and
 * no entry renames itself through a Unicode-path extra field.
 *
 * `visit`, when given, sees every entry's name (as JSZip resolves it) and unzipped bytes and may refuse
 * the archive (day-end-sheet-shape.ts uses it for the sheet's shape, in the same single pass).
 *
 * It returns why a file is refused, for the logs only: every refusal is the same 422
 * `DAY_SHEET_UNREADABLE` (never `FILE_TYPE_NOT_ALLOWED`, whose words are about pictures).
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
/** The end record is 22 bytes plus a comment of at most 65,535 bytes. */
const MAX_END_RECORD_SEARCH = 22 + 0xffff;
/** No real workbook needs more entries; many tiny entries would only cost time. */
const MAX_ENTRIES = 2_000;
/** Info-ZIP's Unicode path extra field: JSZip takes the entry's name from it. */
const UNICODE_PATH_FIELD = 0x7075;

export type ZipCheck = { ok: true; entries: number; unzippedBytes: number } | { ok: false; why: string };

/** Sees one entry: its name as JSZip resolves it and its unzipped bytes. A string refuses the archive. */
export type ZipEntryVisitor = (name: string, data: Buffer) => string | null;

/** True when the bytes begin like a ZIP archive's first local header (`PK\x03\x04`). */
export function hasZipSignature(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.readUInt32LE(0) === LOCAL_HEADER;
}

/** Checks a ZIP archive's structure and its real unzipped size (see the file comment). */
export function inspectZip(bytes: Buffer, limits: { maxUnzippedBytes: number }, visit?: ZipEntryVisitor): ZipCheck {
  if (!hasZipSignature(bytes)) return { ok: false, why: 'no ZIP signature' };
  const end = findEndRecord(bytes);
  if (end < 0) return { ok: false, why: 'no end of central directory' };
  const entries = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) return { ok: false, why: 'ZIP64' };
  if (entries === 0) return { ok: false, why: 'empty archive' };
  if (entries > MAX_ENTRIES) return { ok: false, why: `too many entries (${entries})` };
  if (directoryOffset + directorySize > end) return { ok: false, why: 'central directory out of range' };
  // JSZip moves every offset by the gap between the directory and its end record ("prepended data"), so
  // with a gap it would read another directory than the one checked here.
  if (directoryOffset + directorySize !== end) return { ok: false, why: 'gap before the end of central directory' };

  let at = directoryOffset;
  let declared = 0;
  let actual = 0;
  for (let i = 0; i < entries; i++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== CENTRAL_HEADER) return { ok: false, why: 'bad central directory entry' };
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const compressedSize = bytes.readUInt32LE(at + 20);
    const uncompressedSize = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const localOffset = bytes.readUInt32LE(at + 42);
    if (flags & 0x1) return { ok: false, why: 'encrypted entry' };
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) return { ok: false, why: 'ZIP64 entry' };
    const entryEnd = at + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > end) return { ok: false, why: 'central directory entry out of range' };
    if (hasExtraField(bytes, at + 46 + nameLength, extraLength, UNICODE_PATH_FIELD)) return { ok: false, why: 'Unicode path field' };
    declared += uncompressedSize;
    if (declared > limits.maxUnzippedBytes) return { ok: false, why: 'declared unzipped size over the limit' };

    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== LOCAL_HEADER) return { ok: false, why: 'bad local header' };
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const nameStart = localOffset + 30;
    const dataStart = nameStart + localNameLength + bytes.readUInt16LE(localOffset + 28);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) return { ok: false, why: 'entry data out of range' };
    // JSZip names the entry from its local header; it must match the directory and be plain ASCII.
    const localName = bytes.subarray(nameStart, nameStart + localNameLength);
    if (!localName.equals(bytes.subarray(at + 46, at + 46 + nameLength))) return { ok: false, why: 'local and central names differ' };
    if (!isPlainAscii(localName)) return { ok: false, why: 'entry name not plain ASCII' };
    const data = bytes.subarray(dataStart, dataEnd);

    let unzipped: Buffer;
    if (method === 0) {
      if (compressedSize !== uncompressedSize) return { ok: false, why: 'stored entry with two sizes' };
      unzipped = data;
    } else if (method === 8) {
      const budget = limits.maxUnzippedBytes - actual;
      if (budget <= 0) return { ok: false, why: 'unzipped size over the limit' };
      try {
        unzipped = inflateRawSync(data, { maxOutputLength: budget });
      } catch {
        // Over the cap (ERR_BUFFER_TOO_LARGE) or not valid deflate data.
        return { ok: false, why: 'entry does not inflate within the limit' };
      }
    } else {
      return { ok: false, why: `compression method ${method}` };
    }
    actual += unzipped.length;
    if (actual > limits.maxUnzippedBytes) return { ok: false, why: 'unzipped size over the limit' };
    const refused = visit?.(resolvedName(localName.toString('latin1')), unzipped);
    if (refused) return { ok: false, why: refused };
    at = entryEnd;
  }
  // JSZip reads directory entries for as long as their signature follows: none may hide after the count.
  if (at !== end) return { ok: false, why: 'central directory holds more than its count' };
  return { ok: true, entries, unzippedBytes: actual };
}

/** The offset of the end-of-central-directory record, searched from the end; -1 when there is none. */
function findEndRecord(bytes: Buffer): number {
  const last = bytes.length - 22;
  const first = Math.max(0, bytes.length - MAX_END_RECORD_SEARCH);
  for (let at = last; at >= first; at--) {
    if (bytes.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) return at;
  }
  return -1;
}

/** True when the extra-field block at `start` (of `length` bytes) holds a field with header `id`. */
function hasExtraField(bytes: Buffer, start: number, length: number, id: number): boolean {
  let at = start;
  const stop = start + length;
  while (at + 4 <= stop) {
    if (bytes.readUInt16LE(at) === id) return true;
    at += 4 + bytes.readUInt16LE(at + 2);
  }
  return false;
}

function isPlainAscii(name: Buffer): boolean {
  if (name.length === 0) return false;
  for (const byte of name) if (byte < 0x20 || byte > 0x7e) return false;
  return true;
}

/** The name as JSZip stores it (`utils.resolve`: "." and empty middle parts dropped, ".." goes up a level). */
function resolvedName(name: string): string {
  const parts = name.split('/');
  const out: string[] = [];
  parts.forEach((part, index) => {
    if (part === '.' || (part === '' && index !== 0 && index !== parts.length - 1)) return;
    if (part === '..') out.pop();
    else out.push(part);
  });
  return out.join('/');
}
