/** Keys that never leave the API in a response or an audit row (API_CONTRACT §3.5). */
export const SECRET_KEYS: ReadonlySet<string> = new Set([
  'passwordHash',
  'cnic',
  'cnicEncrypted',
  'cnicIndex',
  'codeHash',
  'tokenHash',
]);

/**
 * Objects serialised by their own rules (Date, Buffer, Prisma Decimal, Map, Set, binary data) are
 * kept as they are. Plain objects and other class instances are walked by their own keys, which is
 * what JSON.stringify sends.
 */
function isOpaque(value: object): boolean {
  const probe = value as { toJSON?: unknown; pipe?: unknown; getStream?: unknown };
  return (
    typeof probe.toJSON === 'function' ||
    // Streams and Nest's StreamableFile are sent as bytes, not JSON.
    typeof probe.pipe === 'function' ||
    typeof probe.getStream === 'function' ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  );
}

/**
 * Returns `value` without any {@link SECRET_KEYS}, at any depth, in objects and arrays.
 * The input is never mutated: only the objects that held a secret, and their parents, are copied
 * (a copied class instance becomes a plain object with the same JSON). Cycles are left alone; they
 * can't be sent as JSON anyway.
 */
export function stripSecrets<T>(value: T): T {
  return strip(value, new WeakMap<object, unknown>()) as T;
}

function strip(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') return value;
  const cached = seen.get(value);
  if (cached !== undefined) return cached;

  if (Array.isArray(value)) {
    seen.set(value, value);
    let copy: unknown[] | undefined;
    for (let i = 0; i < value.length; i++) {
      const item = strip(value[i], seen);
      if (item !== value[i]) {
        copy ??= value.slice();
        copy[i] = item;
      }
    }
    const result = copy ?? value;
    seen.set(value, result);
    return result;
  }

  if (isOpaque(value)) return value;

  seen.set(value, value);
  const source = value as Record<string, unknown>;
  let copy: Record<string, unknown> | undefined;
  for (const key of Object.keys(source)) {
    if (SECRET_KEYS.has(key)) {
      copy ??= { ...source };
      delete copy[key];
      continue;
    }
    const child = strip(source[key], seen);
    if (child !== source[key]) {
      copy ??= { ...source };
      copy[key] = child;
    }
  }
  const result = copy ?? value;
  seen.set(value, result);
  return result;
}
