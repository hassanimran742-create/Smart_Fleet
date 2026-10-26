import { toAsciiDigits } from './digits';

/** What a human number counts (ADR-22). */
export type HumanNoKind = 'ORDER' | 'TOPUP' | 'REFILL' | 'CYLINDER';

const HUMAN_NO_FORMAT: Readonly<Record<HumanNoKind, { prefix: string; width: number }>> = {
  ORDER: { prefix: '', width: 4 },
  TOPUP: { prefix: 'T', width: 3 },
  REFILL: { prefix: 'R', width: 3 },
  CYLINDER: { prefix: 'C', width: 4 },
};

/**
 * Formats every human number from the distributor's code (ADR-22, API_CONTRACT §1.1):
 *
 * | Kind | Example |
 * |---|---|
 * | ORDER | `formatNo('AG', 'ORDER', 142)` → AG-0142 |
 * | TOPUP | `formatNo('AG', 'TOPUP', 31)` → AG-T031 |
 * | REFILL | `formatNo('AG', 'REFILL', 7)` → AG-R007 |
 * | CYLINDER | `formatNo('AG', 'CYLINDER', 42)` → AG-C0042 (C for cylinder), typed as 42, 0042, C0042 or AG-C0042 ({@link parseCylinderNo}) |
 *
 * Numbers wider than the padding are printed in full (AG-10000, AG-T1000, AG-C10000), so they stay
 * unique. Without a code, only the part after the dash is returned ("C0042"). `n` must be a whole
 * number of 0 or more, else RangeError.
 */
export function formatNo(code: string | null | undefined, kind: HumanNoKind, n: number): string {
  const spec = HUMAN_NO_FORMAT[kind];
  if (!spec) throw new RangeError(`formatNo: unknown kind ${String(kind)}`);
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`formatNo: expected a whole number, got ${n}`);
  const body = `${spec.prefix}${String(n).padStart(spec.width, '0')}`;
  const prefix = typeof code === 'string' ? code.trim() : '';
  return prefix ? `${prefix}-${body}` : body;
}

/** A typed cylinder number read by {@link parseCylinderNo}. */
export interface ParsedCylinderNo {
  /** The distributor code written in the text, else the one in context (upper-cased), else null. */
  code: string | null;
  /** The cylinder's short number (`cylinders.short_no`), at least 1. */
  shortNo: number;
}

/** `42`, `0042`, `C0042` or `AG-C0042` once spaces are gone and letters are upper-case. */
const CYLINDER_NO = /^(?:([A-Z][A-Z0-9]{1,5})-C|C)?([0-9]{1,6})$/;

/**
 * Reads a typed cylinder number (API_CONTRACT §1.1, ADR-22): `42`, `0042`, `C0042` or `AG-C0042`, in
 * any letter case, with spaces ignored and Arabic-Indic or Urdu digits allowed, 1–6 digits with a value
 * of at least 1.
 *
 * `distributorCode` is the distributor in context (the run's for a driver scan, the caller's for the
 * shop, the order's for the office's manual delivery). A code written in the text must equal it;
 * another distributor's code gives null. Without one in context, only a written code tells whose
 * cylinder it is: `parseCylinderNo('42')` gives `{ code: null, shortNo: 42 }`, which the office's
 * lookups treat as unknown.
 *
 * Anything else gives null, including the order form `AG-0042`. Callers answer
 * `SCAN_CYLINDER_UNKNOWN` for a scan and 404 `NOT_FOUND` for a lookup.
 */
export function parseCylinderNo(text: string, distributorCode?: string | null): ParsedCylinderNo | null {
  if (typeof text !== 'string') return null;
  const compact = toAsciiDigits(text).replace(/\s+/g, '').toUpperCase();
  const match = CYLINDER_NO.exec(compact);
  if (!match) return null;
  const shortNo = Number(match[2]);
  if (!Number.isSafeInteger(shortNo) || shortNo < 1) return null;
  const context = typeof distributorCode === 'string' && distributorCode.trim() ? distributorCode.trim().toUpperCase() : null;
  const written = match[1] ?? null;
  if (written !== null && context !== null && written !== context) return null;
  return { code: written ?? context, shortNo };
}
