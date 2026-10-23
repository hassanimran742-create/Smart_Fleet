import { SECRET_KEYS } from './strip-secrets';

/** A value JSON can carry as is. */
export type JsonSafe = string | number | boolean | null | JsonSafe[] | { [key: string]: JsonSafe };

const MAX_DEPTH = 24;

/**
 * A JSON-ready copy of `value` for error details and audit rows: BigInt becomes a digit string (money
 * is paisa), Date an ISO string, Prisma Decimal its text; secret keys, functions, symbols, binary data
 * and `undefined` are left out. Never throws: cycles and very deep values become null.
 */
export function toJsonSafe(value: unknown): JsonSafe | undefined {
  return convert(value, 0, new WeakSet<object>());
}

function convert(value: unknown, depth: number, ancestors: WeakSet<object>): JsonSafe | undefined {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'bigint':
      return value.toString();
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
  }
  if (value === null) return null;
  const object = value as object;
  if (object instanceof Date) return Number.isNaN(object.getTime()) ? null : object.toISOString();
  if (Buffer.isBuffer(object) || object instanceof ArrayBuffer || ArrayBuffer.isView(object)) return undefined;
  if (depth >= MAX_DEPTH || ancestors.has(object)) return null;

  ancestors.add(object);
  try {
    if (Array.isArray(object)) {
      return object.map((item) => {
        const converted = convert(item, depth + 1, ancestors);
        return converted === undefined ? null : converted;
      });
    }
    if (object instanceof Map) {
      return convert(Object.fromEntries(object), depth, ancestors);
    }
    if (object instanceof Set) {
      return convert([...object], depth, ancestors);
    }
    const toJSON = (object as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') {
      // Prisma Decimal and similar: their own JSON form.
      return convert(toJSON.call(object), depth + 1, ancestors);
    }
    const out: { [key: string]: JsonSafe } = {};
    for (const key of Object.keys(object)) {
      if (SECRET_KEYS.has(key)) continue;
      const converted = convert((object as Record<string, unknown>)[key], depth + 1, ancestors);
      if (converted !== undefined) out[key] = converted;
    }
    return out;
  } finally {
    ancestors.delete(object);
  }
}

/** {@link toJsonSafe} for an object, always returning an object. */
export function toJsonSafeObject(value: Record<string, unknown> | null | undefined): { [key: string]: JsonSafe } {
  const converted = toJsonSafe(value ?? {});
  return converted !== null && typeof converted === 'object' && !Array.isArray(converted) ? converted : {};
}
