import { z } from 'zod';
import { latSchema, lngSchema, optionalUuidSchema, requireBothCoordinates, textSchema, uuidSchema } from './common.schema';
import { LEGACY_SCAN_EVENT_TYPES } from './internal/codes';

/**
 * Legacy `POST /custody/scan` (driver), locked down for Inc 1 (API_CONTRACT §7.7). Installed apps send
 * `{ qrCode, eventType, tripId, orderId }`.
 * - Only the four driver moves parse; any other `eventType` is `SCAN_EVENT_NOT_ALLOWED` (403).
 * - `tripId` is required, and `orderId` too for DELIVERED and PICKED_UP_EMPTY.
 * - `toCustodyType` and `toCustodyId` are refused: the server derives where a cylinder goes.
 */
export const custodyScanSchema = z
  .object({
    qrCode: textSchema(3, 128),
    eventType: z.enum(LEGACY_SCAN_EVENT_TYPES, { message: 'SCAN_EVENT_NOT_ALLOWED' }),
    tripId: uuidSchema,
    orderId: optionalUuidSchema,
    lat: latSchema.optional(),
    lng: lngSchema.optional(),
    toCustodyType: z.never().optional(),
    toCustodyId: z.never().optional(),
  })
  .superRefine((scan, ctx) => {
    if ((scan.eventType === 'DELIVERED' || scan.eventType === 'PICKED_UP_EMPTY') && scan.orderId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['orderId'], message: 'REQUIRED' });
    }
    requireBothCoordinates(scan, ctx);
  });
export type CustodyScanInput = z.infer<typeof custodyScanSchema>;

/** The legacy name of {@link custodyScanSchema}. */
export const scanEventSchema = custodyScanSchema;
export type ScanEventInput = CustodyScanInput;

/** The most cylinders one bulk registration may create (API_CONTRACT §7.2). */
export const BULK_REGISTER_MAX = 500;

const blankToUndefined = (value: unknown): unknown =>
  value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value;

/**
 * `POST /cylinders/bulk-register` (office), audited `cylinders.bulk_register` from Inc 1. Exactly one of
 * `quantity` (codes generated `<typeCode>-<8 hex>`) or `serials` (each the serial and the QR value).
 * The first holder is always the distributor's home store: `initialCustodyType` may only be 'STORE'
 * (else `NOT_ALLOWED`), and the service refuses an `initialCustodyId` that isn't the home store
 * (`NOT_ALLOWED`). The legacy screens send both. Unknown distributor or size: 404 `NOT_FOUND`
 * `{field}`; a used serial: 409 `CONFLICT_DUPLICATE`, nothing created.
 */
export const bulkRegisterSchema = z
  .object({
    distributorId: uuidSchema,
    cylinderTypeId: uuidSchema,
    quantity: z.number().int().min(1).max(BULK_REGISTER_MAX).optional(),
    serials: z
      .array(textSchema(3, 128))
      .min(1)
      .max(BULK_REGISTER_MAX)
      .superRefine((serials, ctx) => {
        const seen = new Set<string>();
        serials.forEach((serial, index) => {
          if (seen.has(serial)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: 'DUPLICATE_ITEM' });
          seen.add(serial);
        });
      })
      .optional(),
    state: z.enum(['FULL', 'EMPTY']).default('FULL'),
    initialCustodyType: z.preprocess(
      blankToUndefined,
      z
        .unknown()
        .refine((value) => value === 'STORE', 'NOT_ALLOWED')
        .transform((): 'STORE' => 'STORE')
        .optional(),
    ),
    initialCustodyId: optionalUuidSchema,
  })
  .superRefine((body, ctx) => {
    if (body.quantity === undefined && body.serials === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quantity'], message: 'REQUIRED' });
    } else if (body.quantity !== undefined && body.serials !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['serials'], message: 'NOT_ALLOWED' });
    }
  });
export type BulkRegisterInput = z.infer<typeof bulkRegisterSchema>;

/** `POST /cylinder-types` (office). Seeded codes look like LPG_11.8KG; the code is kept upper-case. */
export const createCylinderTypeSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_.-]{1,40}$/, 'INVALID_FORMAT'),
  name: textSchema(1, 80),
  weightKg: z.number().finite().positive().max(1000),
  capacityUnits: z.number().int().min(1).max(100),
});
export type CreateCylinderTypeInput = z.infer<typeof createCylinderTypeSchema>;
