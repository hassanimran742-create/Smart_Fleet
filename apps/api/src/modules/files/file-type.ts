import type { UploadImageMimeType } from '@smartfleet/shared-types';

export interface DetectedImage {
  mimeType: UploadImageMimeType;
  extension: 'jpg' | 'png' | 'webp';
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buffer: Buffer, bytes: readonly number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, i) => buffer[offset + i] === byte);
}

function ascii(buffer: Buffer, offset: number, text: string): boolean {
  return startsWith(
    buffer,
    [...text].map((ch) => ch.charCodeAt(0)),
    offset,
  );
}

/**
 * The picture type of an upload from its first bytes (API_CONTRACT §7.10), never from its name or the
 * client's Content-Type: JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF····WEBP`.
 * Anything else, including a renamed PDF or an empty file, is null (FILE_TYPE_NOT_ALLOWED).
 */
export function detectImageType(buffer: Buffer): DetectedImage | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { mimeType: 'image/jpeg', extension: 'jpg' };
  if (startsWith(buffer, PNG)) return { mimeType: 'image/png', extension: 'png' };
  if (ascii(buffer, 0, 'RIFF') && ascii(buffer, 8, 'WEBP')) return { mimeType: 'image/webp', extension: 'webp' };
  return null;
}
