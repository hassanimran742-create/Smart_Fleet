import { z } from 'zod';
import {
  isoDateSchema,
  isoDateTimeSchema,
  optionalUuidSchema,
  pageQuerySchema,
  rupeeAmountSchema,
  textSchema,
} from './common.schema';
import { CORRECTION_DIRECTIONS, CORRECTION_REASONS, STATEMENT_KINDS } from './internal/codes';

type StatementKindValue = (typeof STATEMENT_KINDS)[number];

/** The largest single correction: Rs 100,000 (API_CONTRACT §7.8). */
export const CORRECTION_MAX_PAISA = 10000000;

/**
 * `POST /admin/distributors/:id/wallet/corrections` (office, for genuine mistakes only, ADR-10).
 * The service refuses taking more than the balance (`WALLET_ADJUST_EXCEEDS_BALANCE`).
 */
export const walletCorrectionSchema = z.object({
  direction: z.enum(CORRECTION_DIRECTIONS),
  amountPaisa: rupeeAmountSchema(CORRECTION_MAX_PAISA),
  reasonCode: z.enum(CORRECTION_REASONS),
  note: textSchema(10, 300),
  relatedPaymentId: optionalUuidSchema,
  relatedOrderId: optionalUuidSchema,
});
export type WalletCorrectionInput = z.infer<typeof walletCorrectionSchema>;

/** A `YYYY-MM-DD` date or an ISO-8601 instant, for date filters. */
const dateOrDateTimeSchema = z
  .string()
  .trim()
  .refine((value) => isoDateSchema.safeParse(value).success || isoDateTimeSchema.safeParse(value).success, 'INVALID_DATE');

/**
 * The statement `kind` filter (API_CONTRACT §7.8): one `StatementKind` or a comma-separated list of
 * distinct ones (`kind=DELIVERY_COST,DELIVERY_COST_RETURNED`), parsed to a list. A repeated `kind`
 * query parameter is read the same way. An unknown or repeated value is `INVALID_CHOICE` or
 * `DUPLICATE_ITEM` on `kind`; blank or absent means every kind.
 */
export const statementKindsQuerySchema = z.preprocess(
  (value) => {
    const text = Array.isArray(value) ? value.join(',') : value;
    return text === null || (typeof text === 'string' && text.trim() === '') ? undefined : text;
  },
  z
    .string()
    .transform((text, ctx): StatementKindValue[] => {
      const parts = text.split(',').map((part) => part.trim());
      const kinds: StatementKindValue[] = [];
      for (const part of parts) {
        if (!(STATEMENT_KINDS as readonly string[]).includes(part)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'INVALID_CHOICE' });
          return z.NEVER;
        }
        if (kinds.includes(part as StatementKindValue)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DUPLICATE_ITEM' });
          return z.NEVER;
        }
        kinds.push(part as StatementKindValue);
      }
      return kinds;
    })
    .optional(),
);

/** `GET /wallet/statement` and `GET /admin/distributors/:id/wallet/statement`. `kind` comes out as a list. */
export const statementQuerySchema = pageQuerySchema.extend({
  kind: statementKindsQuerySchema,
  from: dateOrDateTimeSchema.optional(),
  to: dateOrDateTimeSchema.optional(),
});
export type StatementQuery = z.infer<typeof statementQuerySchema>;
