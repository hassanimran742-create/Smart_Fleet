import { z } from 'zod';
import { PASSWORD_MIN_LENGTH } from './auth.schema';
import { nullableEmailSchema, reasonSchema, textSchema } from './common.schema';
import { USER_ROLES, USER_STATUSES } from './internal/codes';

/**
 * `PATCH /users/me`: only `name` and `email` change. `phone`, `cnic` and `businessName` are kept in the
 * parsed body (not stripped) so the service can answer 403 `USER_FIELD_OFFICE_ONLY` when they are sent.
 */
export const updateMeSchema = z.object({
  name: textSchema(1, 80).optional(),
  email: nullableEmailSchema,
  phone: z.unknown().optional(),
  cnic: z.unknown().optional(),
  businessName: z.unknown().optional(),
});
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

/** `PATCH /users/:id/status` (office) `{ value, reason }`. */
export const setUserStatusSchema = z.object({
  value: z.enum(USER_STATUSES),
  reason: reasonSchema,
});
export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;

/**
 * `PATCH /users/:id/role` (office) `{ value, reason }`. Every role parses; the service refuses
 * SUPER_ADMIN and mismatched profiles with `USER_ROLE_CHANGE_NOT_ALLOWED`.
 */
export const setUserRoleSchema = z.object({
  value: z.enum(USER_ROLES),
  reason: reasonSchema,
});
export type SetUserRoleInput = z.infer<typeof setUserRoleSchema>;

/** `POST /users/:id/password` (office) `{ password }`. */
export const resetUserPasswordSchema = z.object({
  password: z.string().min(PASSWORD_MIN_LENGTH).max(128),
});
export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;

/** `GET /users?role=` (office): the users list, optionally one role. */
export const usersQuerySchema = z.object({ role: z.enum(USER_ROLES).optional() });
export type UsersQuery = z.infer<typeof usersQuerySchema>;
