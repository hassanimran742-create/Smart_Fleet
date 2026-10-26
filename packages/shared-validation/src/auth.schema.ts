import { z } from 'zod';
import { phoneInputSchema } from './common.schema';

/** An already-normalised Pakistani mobile in E.164 form (`+923XXXXXXXXX`). */
export const phoneSchema = z
  .string()
  .regex(/^\+923\d{9}$/, 'Phone must be in E.164 PK mobile form (+923XXXXXXXXX)');

/** `POST /auth/otp/send`. The endpoint answers 403 `AUTH_OTP_DISABLED` for the pilot (ADR-03). */
export const sendOtpSchema = z.object({
  phone: phoneSchema,
  purpose: z.enum(['LOGIN', 'RESET']).default('LOGIN'),
});
export type SendOtpInput = z.infer<typeof sendOtpSchema>;

/** `POST /auth/otp/verify`. The endpoint answers 403 `AUTH_OTP_DISABLED` for the pilot (ADR-03). */
export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6).regex(/^\d{6}$/),
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

/** `POST /auth/refresh`. */
export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

/** Passwords are never trimmed. The upper bound keeps hashing cheap. */
const PASSWORD_MAX = 128;

/** The minimum length of a new password (API_CONTRACT §7.1). */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * `POST /auth/login` `{ phone, password }`. The phone may be typed in any form; the service
 * normalises it with `normalizePkPhone` and answers `AUTH_INVALID_CREDENTIALS` when it can't.
 */
export const loginSchema = z.object({
  phone: phoneInputSchema,
  password: z.string().min(1).max(PASSWORD_MAX),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** `POST /auth/change-password` `{ currentPassword, newPassword (≥ 8) }`. */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
