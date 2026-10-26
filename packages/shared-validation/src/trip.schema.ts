import { z } from 'zod';
import { optionalTextSchema } from './common.schema';
import { TRIP_STATUSES } from './internal/codes';

/**
 * `PATCH /trips/:id/status` `{ status, reason? }`. The service applies who may move it where
 * (API_CONTRACT §7.7). The office's ABORTED needs a reason of 5–300 characters (`REQUIRED` or
 * `TOO_SHORT` on `reason`); from Inc 2 a COMPLETED `reason` is the trip's `leftoverReason`.
 */
export const updateTripStatusSchema = z
  .object({
    status: z.enum(TRIP_STATUSES),
    reason: optionalTextSchema(300),
  })
  .superRefine((body, ctx) => {
    if (body.status !== 'ABORTED') return;
    if (body.reason === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'REQUIRED' });
    } else if (body.reason.length < 5) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'TOO_SHORT', params: { min: 5 } });
    }
  });
export type UpdateTripStatusInput = z.infer<typeof updateTripStatusSchema>;
