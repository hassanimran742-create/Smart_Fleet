import type { IdName, IsoDateTime, ISODateString, Paisa, UUID } from './common.types';
import type { DistributorRef } from './distributor.types';
import type { WalletSummary } from './wallet.types';

export enum PaymentProviderName {
  JAZZCASH = 'JAZZCASH',
  EASYPAISA = 'EASYPAISA',
  BANK_MANUAL = 'BANK_MANUAL',
  CASH = 'CASH',
}

/** The wire value of a {@link PaymentProviderName}. */
export type PaymentProviderValue = `${PaymentProviderName}`;

/**
 * Mirrors Prisma `PaymentStatus`. A top-up goes PENDING → SUCCESS (approved) or PENDING → REJECTED.
 * Legacy BANK_MANUAL `FAILED` rows are relabelled REJECTED in inc1b; `REFUNDED` is unused.
 */
export enum PaymentStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  REJECTED = 'REJECTED',
}

/** The wire value of a {@link PaymentStatus}. A string union, so Prisma's enum values are assignable to it. */
export type PaymentStatusValue = `${PaymentStatus}`;

/** Mirrors Prisma `PayerChannel`: how the distributor says they paid. */
export const PayerChannel = {
  EASYPAISA_APP: 'EASYPAISA_APP',
  BANK_APP: 'BANK_APP',
  OTHER: 'OTHER',
} as const;
export type PayerChannel = (typeof PayerChannel)[keyof typeof PayerChannel];

/** Reason codes for rejecting a top-up (API_CONTRACT §1.5). `OTHER` needs a note. Listed in display order. */
export const TOPUP_REJECT_REASONS = ['NOT_IN_BANK', 'AMOUNT_DIFFERENT', 'NAME_DIFFERENT', 'DUPLICATE', 'OTHER'] as const;
export type TopupRejectReason = (typeof TOPUP_REJECT_REASONS)[number];

/**
 * The top-up stage people see (API_CONTRACT §1.4): BEING_CHECKED = PENDING, ADDED = SUCCESS,
 * NOT_ADDED = REJECTED or legacy FAILED. Apps map it to `stages.topup.<STAGE>`.
 */
export const PAYMENT_STAGES = ['BEING_CHECKED', 'ADDED', 'NOT_ADDED'] as const;
export type PaymentStage = (typeof PAYMENT_STAGES)[number];

/** Buttons the server allows on a top-up request (API_CONTRACT §1.6). */
export const PAYMENT_ACTIONS = ['APPROVE', 'REJECT'] as const;
export type PaymentAction = (typeof PAYMENT_ACTIONS)[number];

/** `GET /admin/topups?tab=` (office). "To check" is sorted oldest first; the others newest first. */
export const ADMIN_TOPUP_TABS = ['to-check', 'approved', 'rejected', 'all'] as const;
export type AdminTopupTab = (typeof ADMIN_TOPUP_TABS)[number];

/** The company bank account shown to distributors (setting `topup.account`, set only by the CLI). */
export interface TopupAccount {
  accountTitle: string;
  bankName: string;
  iban: string;
  accountNumber: string;
}

/** When the office checks top-ups, as local "HH:mm" times in the business time zone. */
export interface CheckingHours {
  from: string;
  to: string;
}

/** The legacy payment shape. New screens read {@link PaymentDto}. */
export interface Payment {
  id: UUID;
  distributorId: UUID;
  amountPaisa: Paisa;
  provider: PaymentProviderName;
  /** NULL for BANK_MANUAL top-ups (DATA_MODEL §3.2). */
  providerTxnId?: string | null;
  status: PaymentStatus;
  proofUrl?: string;
  verifiedByUserId?: UUID;
  createdAt: ISODateString;
  completedAt?: ISODateString;
}

export interface InitiateTopupRequest {
  distributorId: UUID;
  amountPaisa: Paisa;
  provider: PaymentProviderName;
}

/** Also the response of the legacy `POST /payments/topup` (`formFields.instructions`). */
export interface InitiateTopupResponse {
  paymentId: UUID;
  redirectUrl?: string;
  formFields?: Record<string, string>;
}

/** A top-up request (API_CONTRACT §7). Fields marked "office only" are absent in distributor views. */
export interface PaymentDto {
  id: UUID;
  requestNo: number;
  /** `formatNo(code, 'TOPUP', requestNo)`, for example "AG-T031". */
  shortCode: string;
  /** What the distributor said they paid. */
  amountPaisa: Paisa;
  /** What was added to the wallet; null until approved. It can differ from `amountPaisa`. */
  creditedPaisa: Paisa | null;
  status: PaymentStatusValue;
  stage: PaymentStage;
  payerName: string | null;
  payerChannel: PayerChannel | null;
  transactionId: string | null;
  /** Signed URL of the screenshot, valid for 1 hour. */
  proofUrl: string | null;
  createdAt: IsoDateTime;
  reviewedAt: IsoDateTime | null;
  rejectReasonCode: TopupRejectReason | null;
  rejectNote: string | null;
  allowedActions: PaymentAction[];
  /** Office only. */
  distributor?: DistributorRef;
  /** Office only: the reference as the super admin typed it. */
  bankReference?: string | null;
  /** Office only. */
  bankAmountPaisa?: Paisa | null;
  /** Office only. */
  bankReceivedAt?: IsoDateTime | null;
  /** Office only. */
  reviewedBy?: IdName | null;
}

/** `GET /payments/topup-info` (distributor). */
export interface TopupInfoDto {
  account: TopupAccount;
  /** `maxNowPaisa` is the most that fits under the wallet cap now; null without a cap. */
  limits: { minPaisa: Paisa; maxPaisa: Paisa; maxNowPaisa: Paisa | null };
  quickAmountsPaisa: Paisa[];
  payerChannels: PayerChannel[];
  checkingHours: CheckingHours;
  support: { phone: string | null; hours: string | null };
  pending: { count: number; totalPaisa: Paisa };
  /** True on the training server: dummy account details, no real money. */
  training: boolean;
}

/** `GET /admin/topups` (office). */
export interface AdminTopupsDto {
  counts: { toCheck: number; approved: number; rejected: number };
  approvedToday: { count: number; totalPaisa: Paisa };
  items: PaymentDto[];
  nextCursor: string | null;
}

/** `POST /payments/:id/approve` (office). `amountDiffered` is true when the bank amount was credited instead. */
export interface TopupApproveResult {
  payment: PaymentDto;
  wallet: WalletSummary;
  amountDiffered: boolean;
}
