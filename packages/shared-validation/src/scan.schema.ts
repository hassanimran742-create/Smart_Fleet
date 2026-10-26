import { z } from 'zod';
import { latSchema, lngSchema, optionalTextSchema, requireBothCoordinates, textSchema, uuidSchema } from './common.schema';
import { DRIVER_SCAN_ACTIONS, REFILL_SCAN_PHASES, RETURN_STATES, SCAN_ENTRY_METHODS, TAKE_BACK_SHORT_REASONS } from './internal/codes';

/**
 * [Inc 2 and Inc 3] Scan bodies (API_CONTRACT §9.2-§9.5, §10.1). Every one refuses `toCustodyType` and
 * `toCustodyId` (`NOT_ALLOWED`: the server always derives where a cylinder goes) and drops any other
 * unknown field, so none of them is `.strict()`.
 */

/**
 * How a cylinder number reached the server: a QR read, or typed by hand (refused while typing is off).
 * The same list as shared-types `SCAN_ENTRY_METHODS`.
 */
export const ENTRY_METHODS = SCAN_ENTRY_METHODS;
export type EntryMethod = (typeof ENTRY_METHODS)[number];

/** A QR value or a typed cylinder number in a §1.1 form (`42`, `0042`, `C0042`, `AG-C0042`). */
export const cylinderCodeSchema = textSchema(1, 128);

const refusedHolder = {
  toCustodyType: z.never().optional(),
  toCustodyId: z.never().optional(),
};

/**
 * `POST /trips/:tripId/scans` (the trip's driver). A TAKE_BACK without `returnState` is
 * `SCAN_RETURN_STATE_REQUIRED`, so a body failing only on that answers that code (§9.2 step 0).
 */
export const tripScanSchema = z
  .object({
    scanId: uuidSchema,
    stopId: uuidSchema,
    action: z.enum(DRIVER_SCAN_ACTIONS),
    code: cylinderCodeSchema,
    entryMethod: z.enum(ENTRY_METHODS),
    returnState: z.enum(RETURN_STATES).optional(),
    lat: latSchema.optional(),
    lng: lngSchema.optional(),
    ...refusedHolder,
  })
  .superRefine((scan, ctx) => {
    if (scan.action === 'TAKE_BACK' && scan.returnState === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['returnState'], message: 'SCAN_RETURN_STATE_REQUIRED' });
    }
    requireBothCoordinates(scan, ctx);
  });
export type TripScanInput = z.infer<typeof tripScanSchema>;

/** `POST /store/scans` (the shop's RECEIVE): no field can name a store (ADR-13). */
export const storeScanSchema = z.object({
  scanId: uuidSchema,
  code: cylinderCodeSchema,
  entryMethod: z.enum(ENTRY_METHODS),
  ...refusedHolder,
});
export type StoreScanInput = z.infer<typeof storeScanSchema>;

/**
 * [Inc 3] `POST /filling-orders/:id/scans` (the refill's assigned driver, API_CONTRACT §10.1): PICKUP
 * (store → the refill's van) or FILL (at the station; the van keeps it). Like every scan body it
 * refuses `toCustodyType` and `toCustodyId` and drops other unknown fields.
 */
export const refillScanSchema = z
  .object({
    scanId: uuidSchema,
    phase: z.enum(REFILL_SCAN_PHASES),
    code: cylinderCodeSchema,
    entryMethod: z.enum(ENTRY_METHODS),
    lat: latSchema.optional(),
    lng: lngSchema.optional(),
    ...refusedHolder,
  })
  .superRefine(requireBothCoordinates);
export type RefillScanInput = z.infer<typeof refillScanSchema>;

/**
 * `PUT /trips/:tripId/stops/:stopId/unlabelled-returns`: replaces the stop's whole list. At most 20
 * items, one per size and state (`DUPLICATE_ITEM`); a count of 0 keeps no row.
 */
export const unlabelledReturnsSchema = z.object({
  items: z
    .array(
      z.object({
        cylinderTypeId: uuidSchema,
        state: z.enum(RETURN_STATES),
        count: z.number().int().min(0).max(30),
      }),
    )
    .max(20)
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        const key = `${item.cylinderTypeId}:${item.state}`;
        if (seen.has(key)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'state'], message: 'DUPLICATE_ITEM' });
        }
        seen.add(key);
      });
    }),
});
export type UnlabelledReturnsInput = z.infer<typeof unlabelledReturnsSchema>;

/** `POST /trips/:tripId/stops/:stopId/finish`: `takeBackShort` explains a short take-back at a DELIVERY stop. */
export const finishStopSchema = z.object({
  takeBackShort: z
    .object({
      reasonCode: z.enum(TAKE_BACK_SHORT_REASONS),
      note: optionalTextSchema(300, 3),
    })
    .superRefine((value, ctx) => {
      if (value.reasonCode === 'OTHER' && !value.note) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'NOTE_REQUIRED', params: { min: 3 } });
      }
    })
    .optional(),
});
export type FinishStopInput = z.infer<typeof finishStopSchema>;

/**
 * `POST /trips/:tripId/finish` ("Finish trip"). `leftoverReason` is 5–300 characters after trimming;
 * it is used only while `trip.allowFinishWithLeftovers` is on and the van isn't empty.
 */
export const finishTripSchema = z.object({
  leftoverReason: textSchema(5, 300).optional(),
});
export type FinishTripInput = z.infer<typeof finishTripSchema>;

/**
 * `POST /orders/:id/manual-delivery` v2 (office): the reason and the named cylinders. Each code is a QR
 * value or a cylinder number of the order's distributor. The service resolves and checks them all and
 * refuses the whole request on any problem (`MANUAL_DELIVERY_CYLINDERS_MISMATCH`).
 */
export const manualDeliveryV2Schema = z.object({
  reason: textSchema(10, 300),
  cylinders: z.array(z.object({ code: cylinderCodeSchema })).min(1).max(100),
  takenBack: z
    .array(z.object({ code: cylinderCodeSchema, returnState: z.enum(RETURN_STATES) }))
    .max(100)
    .optional(),
});
export type ManualDeliveryV2Input = z.infer<typeof manualDeliveryV2Schema>;
