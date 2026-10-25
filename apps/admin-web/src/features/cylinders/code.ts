import { formatNo, parseCylinderNo } from '@smartfleet/shared-utils';

/** How a typed cylinder number reads (API_CONTRACT §1.1, ADR-22). */
export interface TypedCylinder {
  /** What to send or look up: the full number ("AG-C0042"), or the text as typed (a scanned QR value). */
  code: string;
  /** The distributor code written in the text ("AG" in "ag-c42"), else null. */
  written: string | null;
  /** True when the text read as a cylinder number at all. */
  isNumber: boolean;
}

/**
 * Reads what the office typed or scanned: `42`, `0042`, `C0042` or `AG-C0042` in any letter case
 * (`parseCylinderNo`), written out in full with the distributor code in context when the text has none
 * (`formatNo`: 1 → AG-C0001). Anything else, such as the QR value a USB scanner types, stays as it is.
 */
export function readCylinderNumber(text: string, contextCode: string | null | undefined): TypedCylinder {
  const trimmed = text.trim();
  const parsed = parseCylinderNo(trimmed);
  if (!parsed) return { code: trimmed, written: null, isNumber: false };
  const prefix = parsed.code ?? (contextCode?.trim() ? contextCode.trim().toUpperCase() : null);
  return { code: formatNo(prefix, 'CYLINDER', parsed.shortNo), written: parsed.code, isNumber: true };
}

/** The distributor code at the start of a full number ("AG" of "AG-C0042"), or null. */
export function codeOfNumber(shortCode: string | null | undefined): string | null {
  if (!shortCode) return null;
  const match = /^([A-Z][A-Z0-9]{1,5})-C\d+$/.exec(shortCode.trim().toUpperCase());
  return match ? (match[1] ?? null) : null;
}
