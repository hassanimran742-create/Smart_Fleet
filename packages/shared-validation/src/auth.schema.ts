import { z } from 'zod';

export const phoneSchema = z
  .string()
  .regex(/^\+923\d{9}$/, 'Phone must be in E.164 PK mobile form (+923XXXXXXXXX)');

export const sendOtpSchema = z.object({
  phone: phoneSchema,
  purpose: z.enum(['LOGIN', 'RESET']).default('LOGIN'),
});
export type SendOtpInput = z.infer<typeof sendOtpSchema>;

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6).regex(/^\d{6}$/),
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});
