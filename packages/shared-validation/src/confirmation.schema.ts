import { z } from 'zod';
import { pageQuerySchema, reasonSchema } from './common.schema';
import { CASE_STATUSES, CONFIRMATION_RESPONSES, CONFIRMATION_SHARE_VIAS } from './internal/codes';

/**
 * [Inc 2] Confirmation and case bodies (API_CONTRACT §9.6-§9.7, CUSTOMER_PAGE §4). Unknown fields follow
 * the general body rule: they are dropped.
 */

/** `POST /orders/:id/confirmation/new-link` (Idempotency-Key) `{ send?: 'SMS' }`. */
export const newLinkSchema = z.object({
  send: z.literal('SMS').optional(),
});
export type NewLinkInput = z.infer<typeof newLinkSchema>;

/** `POST /orders/:id/confirmation/share` (Idempotency-Key) `{ via }`. */
export const shareSchema = z.object({
  via: z.enum(CONFIRMATION_SHARE_VIAS),
});
export type ShareInput = z.infer<typeof shareSchema>;

/** `POST /alerts/:id/resolve` (office) `{ note }`: trimmed, 5–300 characters. */
export const resolveCaseSchema = z.object({
  note: reasonSchema,
});
export type ResolveCaseInput = z.infer<typeof resolveCaseSchema>;

/**
 * `GET /alerts?type=CUSTOMER_PROBLEM&status=OPEN|RESOLVED&cursor&limit` (office): the cases as
 * `Page<CaseDto>`. `status` defaults to OPEN (oldest first; RESOLVED newest resolved first). Any other
 * `type`, or none, is the legacy array (`alertsQuerySchema`).
 */
export const casesQuerySchema = pageQuerySchema.extend({
  type: z.literal('CUSTOMER_PROBLEM'),
  status: z.enum(CASE_STATUSES).default('OPEN'),
});
export type CasesQuery = z.infer<typeof casesQuerySchema>;

/** `GET /alerts/mine?cursor&limit` (DISTRIBUTOR exact): the caller's OPEN cases, oldest first. */
export const myCasesQuerySchema = pageQuerySchema;
export type MyCasesQuery = z.infer<typeof myCasesQuerySchema>;

/** The longest comment a customer's answer keeps (code points; `delivery_confirmations.comment` is VARCHAR(300)). */
export const CUSTOMER_COMMENT_MAX = 300;
/** The shortest cleaned comment an "Other problem" answer needs. */
export const CUSTOMER_OTHER_COMMENT_MIN = 3;

/**
 * Cleans a customer's comment in the CUSTOMER_PAGE §4 order: each line break (CRLF, CR, LF) and tab
 * becomes a space; other control characters (U+0000–U+001F, U+007F–U+009F) are removed; runs of spaces
 * become one; trimmed; cut to 300 code points. Empty (or anything that isn't text) gives null.
 */
export function cleanCustomerComment(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/\r\n|\r|\n|\t/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  const cut = Array.from(cleaned).slice(0, CUSTOMER_COMMENT_MAX).join('').trim();
  return cut === '' ? null : cut;
}

/**
 * `POST /c/:token` (the public form post, after the page's state order). `answer` must be exactly YES,
 * PARTLY, NO or OTHER (`REQUIRED` / `INVALID_CHOICE`: the page answers 400 "Please choose one of the
 * answers below."). `comment` comes out cleaned ({@link cleanCustomerComment}); OTHER needs at least 3
 * characters of it (`NOTE_REQUIRED` on `comment`: the page answers 400 `CONFIRM_NOTE_REQUIRED`). `v` is
 * ignored.
 */
export const customerAnswerSchema = z
  .object({
    answer: z.enum(CONFIRMATION_RESPONSES),
    comment: z.unknown().transform(cleanCustomerComment),
  })
  .superRefine((body, ctx) => {
    if (body.answer === 'OTHER' && (body.comment === null || Array.from(body.comment).length < CUSTOMER_OTHER_COMMENT_MIN)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['comment'],
        message: 'NOTE_REQUIRED',
        params: { min: CUSTOMER_OTHER_COMMENT_MIN },
      });
    }
  });
export type CustomerAnswerInput = z.infer<typeof customerAnswerSchema>;
