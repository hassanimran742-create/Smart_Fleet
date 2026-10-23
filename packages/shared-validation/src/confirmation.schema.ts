import { z } from 'zod';
import { reasonSchema } from './common.schema';
import { CONFIRMATION_SHARE_VIAS } from './internal/codes';

/**
 * [Inc 2] Confirmation and case bodies (API_CONTRACT §9.6-§9.7). Unknown fields follow the general body
 * rule: they are dropped.
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
