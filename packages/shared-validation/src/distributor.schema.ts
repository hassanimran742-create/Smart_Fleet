import { z } from 'zod';
import {
  latSchema,
  lngSchema,
  nullableEmailSchema,
  optionalEmailSchema,
  optionalTextSchema,
  phoneInputSchema,
  reasonSchema,
  requireBothCoordinates,
  textSchema,
} from './common.schema';

/** A distributor code (ADR-22): 2–6 capital letters or digits, starting with a letter. */
export const DISTRIBUTOR_CODE_REGEX = /^[A-Z][A-Z0-9]{1,5}$/;

/**
 * A distributor code, trimmed. It must already be capitals (API_CONTRACT §7.3 rule 2): "cg" is
 * `DISTRIBUTOR_CODE_INVALID`, not read as "CG". The website upper-cases the field as it is typed.
 */
export const distributorCodeSchema = z.string().trim().regex(DISTRIBUTOR_CODE_REGEX, 'DISTRIBUTOR_CODE_INVALID');

/** A CNIC with or without dashes, returned as its 13 digits. The service stores it encrypted. */
export const cnicSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine((digits) => /^\d{13}$/.test(digits), 'INVALID_CNIC');

/** An optional CNIC on create: blank or null counts as not sent. */
export const optionalCnicSchema = z.preprocess(
  (value) => (value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value),
  cnicSchema.optional(),
);

/** A CNIC on update: blank or null clears it, absent leaves it unchanged. */
export const nullableCnicSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  cnicSchema.nullable().optional(),
);

/** The distributor's one store: drivers load here (ADR-01). The zone comes from the pin. */
export const storeInputSchema = z.object({
  name: textSchema(1, 120),
  address: textSchema(1, 255),
  lat: latSchema,
  lng: lngSchema,
});
export type StoreInput = z.infer<typeof storeInputSchema>;

/**
 * `POST /distributors` (office). The service normalises the phone (`USER_PHONE_IN_USE`), defaults the
 * code from the business initials, derives the zone (`STORE_OUTSIDE_ZONES`) and checks the CNIC.
 */
export const createDistributorSchema = z.object({
  phone: phoneInputSchema,
  name: textSchema(1, 80),
  businessName: textSchema(1, 120),
  code: distributorCodeSchema.optional(),
  cnic: optionalCnicSchema,
  email: optionalEmailSchema,
  store: storeInputSchema,
});
export type CreateDistributorInput = z.infer<typeof createDistributorSchema>;

/** `PATCH /distributors/:id` (office). A blank or null email clears it. */
export const updateDistributorSchema = z.object({
  businessName: textSchema(1, 120).optional(),
  name: textSchema(1, 80).optional(),
  email: nullableEmailSchema,
  phone: phoneInputSchema.optional(),
});
export type UpdateDistributorInput = z.infer<typeof updateDistributorSchema>;

/** `PATCH /distributors/:id/store` (office). A moved pin needs both `lat` and `lng`. */
export const updateDistributorStoreSchema = z
  .object({
    name: textSchema(1, 120).optional(),
    address: textSchema(1, 255).optional(),
    lat: latSchema.optional(),
    lng: lngSchema.optional(),
  })
  .superRefine(requireBothCoordinates);
export type UpdateDistributorStoreInput = z.infer<typeof updateDistributorStoreSchema>;

/** `PATCH /distributors/:id/code` (office), allowed only before the first order (`DISTRIBUTOR_CODE_LOCKED`). */
export const changeDistributorCodeSchema = z.object({
  code: distributorCodeSchema,
});
export type ChangeDistributorCodeInput = z.infer<typeof changeDistributorCodeSchema>;

/** `PATCH /distributors/:id/suspend` (office) `{ reason }`. */
export const suspendDistributorSchema = z.object({
  reason: reasonSchema,
});
export type SuspendDistributorInput = z.infer<typeof suspendDistributorSchema>;

/**
 * `PATCH /distributors/:id/approve` (office): activates from PENDING (no body needed) or reactivates
 * from SUSPENDED. The service requires the reason for a SUSPENDED distributor (`VALIDATION_FAILED`,
 * path `reason`, code `REQUIRED`), because only then does it know the status.
 */
export const approveDistributorSchema = z
  .object({
    reason: optionalTextSchema(300, 5),
  })
  .default({});
export type ApproveDistributorInput = z.infer<typeof approveDistributorSchema>;
