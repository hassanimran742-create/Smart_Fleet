import { inflateRawSync } from 'zlib';

/**
 * [Inc 3] The upload's file check before any spreadsheet code reads it (API_CONTRACT §10.2 check 3):
 * the bytes start with the ZIP signature `PK\x03\x04`, and the archive unzips to at most `maxUnzippedBytes`
 * in total. Every entry is really inflated, with a hard output cap, so a "zip bomb" whose headers lie
 * about its sizes is caught here and never reaches exceljs (which inflates every entry in memory).
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

export type ZipCheck = { ok: true; entries: number; unzippedBytes: number } | { ok: false; why: string };

/** True when the bytes begin like a ZIP archive's first local header (`PK\x03\x04`). */
export function hasZipSignature(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.readUInt32LE(0) === LOCAL_HEADER;
}

/** Checks a ZIP archive's structure and its real unzipped size (see the file comment). */
export function inspectZip(bytes: Buffer, limits: { maxUnzippedBytes: number }): ZipCheck {
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

  let at = directoryOffset;
  let declared = 0;
  let actual = 0;
  for (let i = 0; i < entries; i++) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== CENTRAL_HEADER) return { ok: false, why: 'bad central directory entry' };
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
    declared += uncompressedSize;
    if (declared > limits.maxUnzippedBytes) return { ok: false, why: 'declared unzipped size over the limit' };

    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== LOCAL_HEADER) return { ok: false, why: 'bad local header' };
    const dataStart = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) return { ok: false, why: 'entry data out of range' };
    const data = bytes.subarray(dataStart, dataEnd);

    if (method === 0) {
      if (compressedSize !== uncompressedSize) return { ok: false, why: 'stored entry with two sizes' };
      actual += compressedSize;
    } else if (method === 8) {
      const budget = limits.maxUnzippedBytes - actual;
      if (budget <= 0) return { ok: false, why: 'unzipped size over the limit' };
      try {
        actual += inflateRawSync(data, { maxOutputLength: budget }).length;
      } catch {
        // Over the cap (ERR_BUFFER_TOO_LARGE) or not valid deflate data.
        return { ok: false, why: 'entry does not inflate within the limit' };
      }
    } else {
      return { ok: false, why: `compression method ${method}` };
    }
    if (actual > limits.maxUnzippedBytes) return { ok: false, why: 'unzipped size over the limit' };
    at += 46 + nameLength + extraLength + commentLength;
  }
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
