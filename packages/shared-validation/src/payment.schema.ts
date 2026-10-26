import { z } from 'zod';
import {
  isoDateTimeSchema,
  optionalTextSchema,
  optionalUuidSchema,
  pageQuerySchema,
  requireNoteFor,
  rupeeAmountSchema,
  textSchema,
} from './common.schema';
import { ADMIN_TOPUP_TABS, PAYER_CHANNELS, PAYMENT_PROVIDERS, TOPUP_REJECT_REASONS } from './internal/codes';

/**
 * Legacy `POST /payments/topup` (installed apps send `{ amountPaisa, provider: 'BANK_MANUAL' }`).
 * The amount is positive whole rupees; the service applies `topup.minPaisa`/`maxPaisa` and accepts
 * only BANK_MANUAL for the pilot.
 */
export const topupSchema = z.object({
  amountPaisa: rupeeAmountSchema(),
  provider: z.enum(PAYMENT_PROVIDERS),
});
export type TopupInput = z.infer<typeof topupSchema>;

/** @deprecated Matches no route. Legacy `POST /payments/:id/bank-proof` takes {@link bankProofSchema}. */
export const manualBankProofSchema = z.object({
  paymentId: z.string().uuid(),
  proofUrl: z.string().url(),
  bankRef: z.string().min(3).max(64),
});

/** Legacy `POST /payments/:id/bank-proof` `{ proofUrl }`: the URL or key of the caller's own upload. */
export const bankProofSchema = z.object({
  proofUrl: textSchema(1, 2048),
});
export type BankProofInput = z.infer<typeof bankProofSchema>;

/** Legacy `POST /payments/:id/verify` (office): `approve` must be a real boolean, never "true". */
export const verifyPaymentSchema = z.object({
  approve: z.boolean(),
});
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;

/**
 * `POST /payments/topup-requests` (distributor): "tell us you paid" (API_CONTRACT §7.9). The service
 * checks the limits and cap (`TOPUP_AMOUNT_TOO_SMALL`/`_TOO_LARGE`, `TOPUP_WOULD_EXCEED_CAP`), the
 * pending count and that `proofFileId` is the caller's own TOPUP_PROOF upload.
 */
export const topupRequestSchema = z.object({
  amountPaisa: rupeeAmountSchema(),
  payerName: textSchema(2, 60),
  payerChannel: z.enum(PAYER_CHANNELS),
  transactionId: z.preprocess(
    (value) => (value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value),
    z
      .string()
      .trim()
      .max(40)
      .regex(/^[A-Za-z0-9-]+$/, 'INVALID_FORMAT')
      .optional(),
  ),
  proofFileId: optionalUuidSchema,
});
export type TopupRequestInput = z.infer<typeof topupRequestSchema>;

/** The shortest and longest normalised bank reference (API_CONTRACT §7.9). */
export const BANK_REFERENCE_MIN_LENGTH = 3;
export const BANK_REFERENCE_MAX_LENGTH = 40;
/** The longest bank reference as typed, before normalising (API_CONTRACT §7.9 rule 2). */
export const BANK_REFERENCE_MAX_TYPED_LENGTH = 100;

/**
 * How far the bank time may be ahead of the server clock, for clock differences: 5 minutes
 * (API_CONTRACT §7.9 rule 3). Later is `TOPUP_BANK_TIME_IN_FUTURE`; the website's bank-time field uses
 * the same bound (UX_ADMIN §2.2).
 */
export const BANK_TIME_MAX_AHEAD_MS = 5 * 60 * 1000;

/**
 * The key a bank reference is stored and checked under: upper-case, A–Z and 0–9 only, so spaces and
 * dashes don't matter ("ft-7781 4402" → "FT77814402"). Each key can be used once ever.
 */
export function normalizeBankReference(reference: string): string {
  return reference.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** True when the reference normalises to 3–40 characters. */
export function isValidBankReference(reference: string): boolean {
  const key = normalizeBankReference(reference);
  return key.length >= BANK_REFERENCE_MIN_LENGTH && key.length <= BANK_REFERENCE_MAX_LENGTH;
}

const bankReferenceSchema = z.unknown().transform((value, ctx): string => {
  const text = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  if (text.length > BANK_REFERENCE_MAX_TYPED_LENGTH || !isValidBankReference(text)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'TOPUP_BANK_REFERENCE_REQUIRED' });
    return z.NEVER;
  }
  return text;
});

/**
 * `POST /payments/:id/approve` (office) `{ bankReference, bankAmountPaisa, bankTime }`, all required.
 * The parsed body adds `bankReferenceKey`, the normalised reference for `payments.bank_reference_key`.
 * The service checks the limits, a time in the future (`TOPUP_BANK_TIME_IN_FUTURE`) and a different
 * amount (`topup.onAmountMismatch`).
 */
export const approveTopupSchema = z
  .object({
    bankReference: bankReferenceSchema,
    bankAmountPaisa: rupeeAmountSchema(),
    bankTime: isoDateTimeSchema,
  })
  .transform((body) => ({ ...body, bankReferenceKey: normalizeBankReference(body.bankReference) }));
export type ApproveTopupInput = z.infer<typeof approveTopupSchema>;

/** `POST /payments/:id/reject` (office). `OTHER` needs a note, which the distributor sees. */
export const rejectTopupSchema = z
  .object({
    reasonCode: z.enum(TOPUP_REJECT_REASONS),
    note: optionalTextSchema(300, 3),
  })
  .superRefine(requireNoteFor(['OTHER'], 3));
export type RejectTopupInput = z.infer<typeof rejectTopupSchema>;

/** `GET /admin/topups?tab&q&cursor` (office). */
export const adminTopupsQuerySchema = pageQuerySchema.extend({
  tab: z.enum(ADMIN_TOPUP_TABS).default('to-check'),
  q: optionalTextSchema(100),
});
export type AdminTopupsQuery = z.infer<typeof adminTopupsQuerySchema>;
