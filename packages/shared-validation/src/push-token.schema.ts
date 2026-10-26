import { z } from 'zod';
import { optionalTextSchema, textSchema } from './common.schema';

/** `POST /push-tokens` (signed in) `{ token (1–200), platform? }`: upserts by token and moves it to the caller. */
export const registerPushTokenSchema = z.object({
  token: textSchema(1, 200),
  platform: optionalTextSchema(20),
});
export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;

/** `DELETE /push-tokens` (signed in) `{ token }`: removes the row only when it is the caller's. */
export const removePushTokenSchema = z.object({
  token: textSchema(1, 200),
});
export type RemovePushTokenInput = z.infer<typeof removePushTokenSchema>;
