import { useCallback, useReducer, useRef } from 'react';

interface CryptoLike {
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

let counter = 0;

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const crypto = (globalThis as { crypto?: CryptoLike }).crypto;
  if (crypto?.getRandomValues) {
    crypto.getRandomValues(bytes);
    return bytes;
  }
  // Hermes has no Web Crypto in the 0.1.0 APK. Math.random is enough for request and idempotency
  // ids, which must be unique, not secret; the time and a counter are mixed in for safety.
  for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let stamp = Date.now() + counter++;
  for (let i = 0; i < 6; i++) {
    bytes[i] ^= stamp & 0xff;
    stamp = Math.floor(stamp / 256);
  }
  return bytes;
}

/** A UUID v4 for `X-Request-Id` and `Idempotency-Key` (UX_MOBILE §3.1). */
export function newRequestId(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(b, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

export interface IdempotencyKey {
  /** Send as the `Idempotency-Key` header; retries of the same intent reuse it. */
  key: string;
  /** Starts a new intent (call after a success when the screen stays open). */
  renew: () => void;
}

/**
 * One idempotency key per user intent (UX_MOBILE §3.1). The key stays the same across re-renders
 * and retries, and changes when any of `deps` changes (the person changed what they are sending).
 * A retry after a timeout therefore never creates a second order or top-up.
 */
export function useIdempotencyKey(deps: readonly unknown[]): IdempotencyKey {
  const ref = useRef<{ key: string; deps: readonly unknown[] } | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  if (ref.current === null || !sameDeps(ref.current.deps, deps)) {
    ref.current = { key: newRequestId(), deps: [...deps] };
  }
  const renew = useCallback(() => {
    ref.current = { key: newRequestId(), deps: ref.current?.deps ?? [] };
    rerender();
  }, []);
  return { key: ref.current.key, renew };
}

/** Axios config that sends `Idempotency-Key` (every create and money call). */
export function withIdempotencyKey(key: string): { headers: { 'Idempotency-Key': string } } {
  return { headers: { 'Idempotency-Key': key } };
}
