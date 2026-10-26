import { z } from 'zod';
import {
  latSchema,
  lngSchema,
  nullableEmailSchema,
  optionalEmailSchema,
  optionalTextSchema,
  phoneInputSchema,
  reasonSchema,
  textSchema,
  uuidSchema,
} from './common.schema';
import { nullableCnicSchema, optionalCnicSchema } from './distributor.schema';
import { DRIVER_AVAILABILITIES } from './internal/codes';

/** A profile picture link (API_CONTRACT §7.2): at most 500 characters. */
const pictureUrlSchema = textSchema(1, 500);

/**
 * `POST /drivers` (office). The service normalises the phone with `normalizePkPhone` (else
 * `VALIDATION_FAILED`, field `phone`, code `INVALID_PHONE`), refuses a phone any user has
 * (`USER_PHONE_IN_USE` `{existingRole}`, never an upsert) and a used licence number
 * (`CONFLICT_DUPLICATE`), and checks the CNIC as for distributors (§7.3 rule 4).
 */
export const createDriverSchema = z.object({
  name: textSchema(1, 80),
  phone: phoneInputSchema,
  licenceNo: textSchema(1, 40),
  email: optionalEmailSchema,
  cnic: optionalCnicSchema,
  profilePictureUrl: optionalTextSchema(500),
});
export type CreateDriverInput = z.infer<typeof createDriverSchema>;

/**
 * `PATCH /drivers/:id/profile`. Absent leaves a field unchanged; null (or blank) clears email, cnic or
 * the photo. A driver on themselves may send only `name` and `profilePictureUrl`: the service answers
 * 403 `USER_FIELD_OFFICE_ONLY` for any other field, so the office fields are kept in the parsed body.
 */
export const updateDriverProfileSchema = z.object({
  name: textSchema(1, 80).optional(),
  email: nullableEmailSchema,
  cnic: nullableCnicSchema,
  licenceNo: textSchema(1, 40).optional(),
  profilePictureUrl: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    pictureUrlSchema.nullable().optional(),
  ),
});
export type UpdateDriverProfileInput = z.infer<typeof updateDriverProfileSchema>;

/** `DELETE /drivers/:id` (archive) and `PATCH /drivers/:id/reactivate` (office) `{ reason (5–300) }`. */
export const driverReasonSchema = z.object({
  reason: reasonSchema,
});
export type DriverReasonInput = z.infer<typeof driverReasonSchema>;

/** `PATCH /drivers/:id/location` and the socket's `location:update` `{ lat, lng }` (the driver's own). */
export const driverLocationSchema = z.object({ lat: latSchema, lng: lngSchema });
export type DriverLocationInput = z.infer<typeof driverLocationSchema>;

/** `PATCH /drivers/:id/online` and the socket's `online:set` `{ isOnline }` (the driver's own). */
export const driverOnlineSchema = z.object({ isOnline: z.boolean() });
export type DriverOnlineInput = z.infer<typeof driverOnlineSchema>;

/** `PATCH /drivers/:id/vehicle` (office) `{ vehicleId }`: a van's id, or null to take the van away. */
export const driverVehicleSchema = z.object({ vehicleId: uuidSchema.nullable() });
export type DriverVehicleInput = z.infer<typeof driverVehicleSchema>;

const leaveDateSchema = optionalTextSchema(40).refine(
  (value) => value === undefined || !Number.isNaN(Date.parse(value)),
  'INVALID_DATE',
);

/** `PATCH /drivers/:id/availability` (office) `{ availability, leaveStart?, leaveEnd?, reason? }`. */
export const driverAvailabilitySchema = z
  .object({
    availability: z.enum(DRIVER_AVAILABILITIES),
    leaveStart: leaveDateSchema,
    leaveEnd: leaveDateSchema,
    reason: optionalTextSchema(300),
  })
  .superRefine((value, ctx) => {
    if (value.leaveStart && value.leaveEnd && Date.parse(value.leaveEnd) < Date.parse(value.leaveStart)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['leaveEnd'], message: 'END_BEFORE_START' });
    }
  });
export type DriverAvailabilityInput = z.infer<typeof driverAvailabilitySchema>;
