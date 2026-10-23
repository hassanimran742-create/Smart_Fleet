import { z } from 'zod';
import { reasonSchema } from './common.schema';

/**
 * `PATCH /settings/:key` (office) `{ value, reason (5–300) }`. `value` must be present (null is a real
 * value, such as "no cap"); the settings registry validates it per key (`SETTING_INVALID_VALUE`).
 */
export const patchSettingSchema = z.object({
  value: z.custom<unknown>((value) => value !== undefined, 'REQUIRED'),
  reason: reasonSchema,
});
export type PatchSettingInput = z.infer<typeof patchSettingSchema>;
