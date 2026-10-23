import { formatNo, parseCylinderNo } from '@smartfleet/shared-utils';
import type { Db } from '../orders/support/tx';

/** How a cylinder number reached the server (API_CONTRACT §9.2 step 4-5). */
export type EntryMethod = 'QR' | 'TYPED';

/** The human number of a cylinder ("AG-C0042"), or null when it has no short number yet. */
export function cylinderShortCode(distributorCode: string | null | undefined, shortNo: number | null | undefined): string | null {
  if (shortNo === null || shortNo === undefined) return null;
  return formatNo(distributorCode ?? null, 'CYLINDER', shortNo);
}

/** A distributor a typed number is read within: the run's, the caller's or the order's (API_CONTRACT §1.1). */
export interface CodeContext {
  id: string;
  code: string;
}

/**
 * §9.2 step 5. QR is an exact `qr_code` match, whoever owns the cylinder; TYPED is a cylinder number
 * in a §1.1 form (`42`, `0042`, `C0042`, `AG-C0042`, any letter case) looked up within `distributor`.
 * A code part naming another distributor, the order form `AG-0042` or no match gives null: the caller
 * answers SCAN_CYLINDER_UNKNOWN.
 */
export async function resolveScanCode(
  db: Db,
  p: { code: string; entryMethod: EntryMethod; distributor: CodeContext },
): Promise<string | null> {
  if (p.entryMethod === 'QR') return byQr(db, p.code);
  return byNumber(db, p.code, p.distributor);
}

/**
 * A code that may be either (the office's manual delivery, §9.5; the owner's history lookup, §9.4): the
 * QR value first, else a cylinder number of `distributor`.
 */
export async function resolveQrOrNumber(db: Db, code: string, distributor: CodeContext): Promise<string | null> {
  return (await byQr(db, code)) ?? (await byNumber(db, code, distributor));
}

/**
 * Without a distributor in context (the office's Find cylinder and history): the QR value, or the full
 * `AG-C0042` form only. A bare `42` names no distributor, so it is unknown.
 */
export async function resolveQrOrFullNumber(db: Db, code: string): Promise<string | null> {
  const qr = await byQr(db, code);
  if (qr) return qr;
  const parsed = parseCylinderNo(code);
  if (!parsed?.code) return null;
  const distributor = await db.distributor.findUnique({ where: { code: parsed.code }, select: { id: true } });
  if (!distributor) return null;
  const cylinder = await db.cylinder.findUnique({
    where: { distributorId_shortNo: { distributorId: distributor.id, shortNo: parsed.shortNo } },
    select: { id: true },
  });
  return cylinder?.id ?? null;
}

async function byQr(db: Db, code: string): Promise<string | null> {
  const cylinder = await db.cylinder.findUnique({ where: { qrCode: code }, select: { id: true } });
  return cylinder?.id ?? null;
}

async function byNumber(db: Db, code: string, distributor: CodeContext): Promise<string | null> {
  const parsed = parseCylinderNo(code, distributor.code);
  if (!parsed) return null;
  const cylinder = await db.cylinder.findUnique({
    where: { distributorId_shortNo: { distributorId: distributor.id, shortNo: parsed.shortNo } },
    select: { id: true },
  });
  return cylinder?.id ?? null;
}
