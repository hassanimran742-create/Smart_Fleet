import type { PaymentStatus, Prisma } from '@prisma/client';
import type { AdminTopupTab } from '@smartfleet/shared-types';
import { BANK_REFERENCE_MIN_LENGTH, BANK_TIME_MAX_AHEAD_MS, normalizeBankReference } from '@smartfleet/shared-validation';
import { AppError } from '../../common/errors/app-error';

/** The top-up limits of the moment (settings `topup.minPaisa` / `topup.maxPaisa`). */
export interface TopupLimits {
  minPaisa: bigint;
  maxPaisa: bigint;
}

/** TOPUP_AMOUNT_TOO_SMALL / _TOO_LARGE `{minPaisa, maxPaisa}` outside the limits (API_CONTRACT §7.9 rule 3). */
export function assertTopupAmount(amountPaisa: bigint, limits: TopupLimits): void {
  const details = { minPaisa: limits.minPaisa.toString(), maxPaisa: limits.maxPaisa.toString() };
  if (amountPaisa < limits.minPaisa) throw new AppError('TOPUP_AMOUNT_TOO_SMALL', details);
  if (amountPaisa > limits.maxPaisa) throw new AppError('TOPUP_AMOUNT_TOO_LARGE', details);
}

/** The most that fits under the cap now (never below 0); null without a cap. */
export function roomUnderCap(capPaisa: bigint | null, balancePaisa: bigint, pendingPaisa: bigint): bigint | null {
  if (capPaisa === null) return null;
  const room = capPaisa - balancePaisa - pendingPaisa;
  return room > 0n ? room : 0n;
}

/**
 * The wallet cap (`wallet.maxBalancePaisa`) limits top-ups only (ADR-10): a request needs
 * balance + pending + amount ≤ cap; an approval needs balance + credited ≤ cap (pass pending 0).
 */
export function assertUnderCap(capPaisa: bigint | null, balancePaisa: bigint, pendingPaisa: bigint, amountPaisa: bigint): void {
  const room = roomUnderCap(capPaisa, balancePaisa, pendingPaisa);
  if (capPaisa === null || room === null || amountPaisa <= room) return;
  throw new AppError('TOPUP_WOULD_EXCEED_CAP', { capPaisa: capPaisa.toString(), maxNowPaisa: room.toString() });
}

/** The bank time may run at most 5 minutes ahead of the server clock (clock differences, G02-02). */
export function isBankTimeInFuture(bankTime: Date, now: Date = new Date()): boolean {
  return bankTime.getTime() > now.getTime() + BANK_TIME_MAX_AHEAD_MS;
}

/** The statuses each office tab lists (API_CONTRACT §7.9). Legacy FAILED rows count as rejected. */
export const TAB_STATUSES: Readonly<Record<AdminTopupTab, readonly PaymentStatus[] | null>> = {
  'to-check': ['PENDING'],
  approved: ['SUCCESS'],
  rejected: ['REJECTED', 'FAILED'],
  all: null,
};

/** "AG-T031" (any letter case, spaces ignored) → `{ code: 'AG', requestNo: 31 }`; anything else null. */
export function parseTopupShortCode(text: string): { code: string; requestNo: number } | null {
  const match = /^([A-Z][A-Z0-9]{1,5})-T(\d{1,9})$/.exec(text.replace(/\s+/g, '').toUpperCase());
  if (!match) return null;
  const requestNo = Number(match[2]);
  return Number.isSafeInteger(requestNo) ? { code: match[1], requestNo } : null;
}

/**
 * `GET /admin/topups?q=` (G02-02): case-insensitive part of the business name, the payer name or the
 * transaction ID; the request's short code exactly (`ag-t031`); or, when the text normalises to 3 or
 * more characters, part of the normalised bank reference (`ft 7781` finds `FT-7781-4402`).
 */
export function topupSearchWhere(q: string): Prisma.PaymentWhereInput {
  const text = q.trim();
  const or: Prisma.PaymentWhereInput[] = [
    { distributor: { businessName: { contains: text, mode: 'insensitive' } } },
    { payerName: { contains: text, mode: 'insensitive' } },
    { transactionId: { contains: text, mode: 'insensitive' } },
  ];
  const short = parseTopupShortCode(text);
  if (short) or.push({ requestNo: short.requestNo, distributor: { code: short.code } });
  const key = normalizeBankReference(text);
  if (key.length >= BANK_REFERENCE_MIN_LENGTH) or.push({ bankReferenceKey: { contains: key } });
  return { OR: or };
}
