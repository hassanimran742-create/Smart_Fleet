/**
 * Byte helpers for the day-end sheet (S19): the workbook comes from the API as bytes and is written
 * into the shop's folder as base64; a refusal's JSON body comes as bytes too. Hermes in the 0.1.0 app
 * has neither `btoa` for bytes nor `TextDecoder`, so both are done here.
 *
 * This module imports nothing, so the API's unit tests can load it on its own.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 (RFC 4648, with padding) of `bytes`. */
export function bytesToBase64(bytes: Uint8Array): string {
  const out: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out.push(ALPHABET[(n >> 18) & 63], ALPHABET[(n >> 12) & 63], ALPHABET[(n >> 6) & 63], ALPHABET[n & 63]);
  }
  const left = bytes.length - i;
  if (left === 1) {
    const n = bytes[i] << 16;
    out.push(ALPHABET[(n >> 18) & 63], ALPHABET[(n >> 12) & 63], '==');
  } else if (left === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out.push(ALPHABET[(n >> 18) & 63], ALPHABET[(n >> 12) & 63], ALPHABET[(n >> 6) & 63], '=');
  }
  return out.join('');
}

/** UTF-8 text of `bytes`; a malformed sequence reads as U+FFFD, as browsers do. */
export function bytesToText(bytes: Uint8Array): string {
  let text = '';
  let i = 0;
  while (i < bytes.length) {
    const first = bytes[i];
    let code = 0xfffd;
    let size = 1;
    if (first < 0x80) {
      code = first;
    } else if (first >= 0xc2 && first < 0xe0 && i + 1 < bytes.length && (bytes[i + 1] & 0xc0) === 0x80) {
      code = ((first & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      size = 2;
    } else if (first >= 0xe0 && first < 0xf0 && i + 2 < bytes.length && (bytes[i + 1] & 0xc0) === 0x80 && (bytes[i + 2] & 0xc0) === 0x80) {
      code = ((first & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      size = 3;
    } else if (
      first >= 0xf0 &&
      first < 0xf5 &&
      i + 3 < bytes.length &&
      (bytes[i + 1] & 0xc0) === 0x80 &&
      (bytes[i + 2] & 0xc0) === 0x80 &&
      (bytes[i + 3] & 0xc0) === 0x80
    ) {
      code = ((first & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      size = 4;
    }
    text += String.fromCodePoint(code);
    i += size;
  }
  return text;
}
