import { z } from 'zod';
import { isoDateSchema, optionalTextSchema, pageQuerySchema, reasonSchema } from './common.schema';
import { DAY_CLOSE_STATUSES } from './internal/codes';

/**
 * [Inc 3] Day-end request bodies and queries (API_CONTRACT §10.2). Every day-end route answers 403
 * `FEATURE_DISABLED` (`X-Feature-Disabled: dayEnd`) while `dayEnd.enabled` is off, before any of these
 * run. The upload is multipart (field `file`) and has no body schema: its checks are the sheet's own.
 */

/**
 * The `:date` of the shop's routes: a real `YYYY-MM-DD`. The service answers 404 `DAY_NOT_FOUND` (never
 * 400) when it fails, or when the date is later than the current business date.
 */
export const businessDateParamSchema = isoDateSchema;

/** A sheet version (`day_closes.upload_version`): the first upload is version 1. */
const versionSchema = z.number().int().min(1);

/**
 * `POST /day-end/:date/submit` (the shop) `{ version, note? }`: the version must be the latest upload's
 * (409 `DAY_VERSION_CHANGED`); the note (at most 300 characters) is the `day.submit` audit reason.
 */
export const dayEndSubmitSchema = z.object({
  version: versionSchema,
  note: optionalTextSchema(300),
});
export type DayEndSubmitInput = z.infer<typeof dayEndSubmitSchema>;

/** `POST /admin/day-end/:id/approve` (office) `{ version }`: the version the office reviewed. */
export const dayEndApproveSchema = z.object({
  version: versionSchema,
});
export type DayEndApproveInput = z.infer<typeof dayEndApproveSchema>;

/** `POST /admin/day-end/:id/send-back` (office) `{ reason }`, 5–300 characters (audit `day.send_back`). */
export const dayEndSendBackSchema = z.object({
  reason: reasonSchema,
});
export type DayEndSendBackInput = z.infer<typeof dayEndSendBackSchema>;

/** `POST /admin/day-end/:id/reopen` (office, rare) `{ reason }`, 5–300 characters (audit `day.reopen`). */
export const dayEndReopenSchema = z.object({
  reason: reasonSchema,
});
export type DayEndReopenInput = z.infer<typeof dayEndReopenSchema>;

/** `GET /day-end` (the shop's days that have a row, newest first): cursor paging only. */
export const dayEndListQuerySchema = pageQuerySchema;
export type DayEndListQuery = z.infer<typeof dayEndListQuerySchema>;

/**
 * `GET /admin/day-end?status&cursor&limit` (office). The website's tabs: To approve SUBMITTED, Open
 * OPEN, Locked APPROVED. Without `status`, every day is listed.
 */
export const adminDayEndListQuerySchema = pageQuerySchema.extend({
  status: z.enum(DAY_CLOSE_STATUSES).optional(),
});
export type AdminDayEndListQuery = z.infer<typeof adminDayEndListQuerySchema>;
