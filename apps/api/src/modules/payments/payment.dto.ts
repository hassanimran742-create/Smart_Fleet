import type { Prisma } from '@prisma/client';
import type {
  IdName,
  PayerChannel,
  PaymentAction,
  PaymentDto,
  PaymentStage,
  PaymentStatusValue,
  TopupRejectReason,
} from '@smartfleet/shared-types';
import { TOPUP_REJECT_REASONS } from '@smartfleet/shared-types';
import { formatNo } from '@smartfleet/shared-utils';

/** Who reads a top-up request: distributors never see the office's bank details or reviewer. */
export type PaymentView = 'DISTRIBUTOR' | 'OFFICE';

/** What every PaymentDto needs loaded with the payment. */
export const PAYMENT_INCLUDE = {
  distributor: { select: { id: true, businessName: true, code: true } },
  proofFile: { select: { storageKey: true } },
} as const satisfies Prisma.PaymentInclude;

export type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

/** The human number of a top-up request, "AG-T031" ("" for a legacy row without one). */
export function topupShortCode(code: string | null, requestNo: number | null): string {
  return requestNo === null ? '' : formatNo(code, 'TOPUP', requestNo);
}

/** The stage people see (API_CONTRACT §1.4): PENDING → BEING_CHECKED, SUCCESS → ADDED, the rest NOT_ADDED. */
export function paymentStage(status: PaymentStatusValue): PaymentStage {
  if (status === 'PENDING') return 'BEING_CHECKED';
  if (status === 'SUCCESS') return 'ADDED';
  return 'NOT_ADDED';
}

/**
 * The buttons the office may press (API_CONTRACT §1.6): a request being checked can be approved when it
 * is a manual bank top-up, and rejected whatever its provider. Distributors get none.
 */
export function paymentActions(row: Pick<PaymentRow, 'status' | 'provider'>, view: PaymentView): PaymentAction[] {
  if (view !== 'OFFICE' || row.status !== 'PENDING') return [];
  return row.provider === 'BANK_MANUAL' ? ['APPROVE', 'REJECT'] : ['REJECT'];
}

/** What was added to the wallet: the bank amount once approved (old approvals: the requested amount). */
export function creditedPaisa(row: Pick<PaymentRow, 'status' | 'bankAmountPaisa' | 'amountPaisa'>): bigint | null {
  if (row.status !== 'SUCCESS') return null;
  return row.bankAmountPaisa ?? row.amountPaisa;
}

function rejectReason(code: string | null): TopupRejectReason | null {
  return (TOPUP_REJECT_REASONS as readonly string[]).includes(code ?? '') ? (code as TopupRejectReason) : null;
}

/**
 * A top-up request as the API sends it (API_CONTRACT §7). `proofUrl` is signed for one hour by the
 * caller; `reviewer` is the office user who approved or rejected it.
 */
export function toPaymentDto(
  row: PaymentRow,
  view: PaymentView,
  extra: { proofUrl: string | null; reviewer: IdName | null },
): PaymentDto {
  const decided = row.status !== 'PENDING';
  const credited = creditedPaisa(row);
  const dto: PaymentDto = {
    id: row.id,
    requestNo: row.requestNo ?? 0,
    shortCode: topupShortCode(row.distributor.code, row.requestNo),
    amountPaisa: row.amountPaisa.toString(),
    creditedPaisa: credited === null ? null : credited.toString(),
    status: row.status,
    stage: paymentStage(row.status),
    payerName: row.payerName,
    payerChannel: (row.payerChannel as PayerChannel | null) ?? null,
    transactionId: row.transactionId,
    proofUrl: extra.proofUrl,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: decided && row.completedAt ? row.completedAt.toISOString() : null,
    rejectReasonCode: rejectReason(row.rejectReasonCode),
    rejectNote: row.rejectNote,
    allowedActions: paymentActions(row, view),
  };
  if (view === 'OFFICE') {
    dto.distributor = { id: row.distributor.id, businessName: row.distributor.businessName, code: row.distributor.code ?? '' };
    dto.bankReference = row.bankReference;
    dto.bankAmountPaisa = row.bankAmountPaisa === null ? null : row.bankAmountPaisa.toString();
    dto.bankReceivedAt = row.bankReceivedAt ? row.bankReceivedAt.toISOString() : null;
    dto.reviewedBy = extra.reviewer;
  }
  return dto;
}
