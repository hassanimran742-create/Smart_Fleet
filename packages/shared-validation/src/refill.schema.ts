import { z } from 'zod';
import { latSchema, lngSchema, optionalUuidSchema, requireBothCoordinates, textSchema, uuidSchema } from './common.schema';

/**
 * `POST /filling-orders` (distributor): one size per request, no money (ADR-16). The service caps
 * `requestedCount` at `refill.maxCylinders` (`REFILL_TOO_MANY`), ignores `pickupStoreId` and answers
 * 410 `REFILL_DIY_RETIRED` for `serviceType: 'DIY'`, so a DIY body still parses without a station.
 */
export const createFillingOrderSchema = z
  .object({
    fillingStationId: optionalUuidSchema,
    cylinderTypeId: uuidSchema,
    requestedCount: z.number().int('REFILL_INVALID_COUNT').min(1, 'REFILL_INVALID_COUNT'),
    serviceType: z.enum(['OUR_SERVICE', 'DIY']).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.serviceType !== 'DIY' && body.fillingStationId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fillingStationId'], message: 'REQUIRED' });
    }
  });
export type CreateFillingOrderInput = z.infer<typeof createFillingOrderSchema>;

/** `PATCH /filling-orders/:id/cancel` (owning distributor, before pickup) `{ reason }`. */
export const cancelFillingOrderSchema = z.object({
  reason: textSchema(3, 300),
});
export type CancelFillingOrderInput = z.infer<typeof cancelFillingOrderSchema>;

/** `PATCH /filling-orders/:id/picked-empties` (assigned driver). The service checks `emptyCount ≤ requestedCount`. */
export const refillPickedEmptiesSchema = z.object({
  emptyCount: z.number().int('REFILL_INVALID_COUNT').min(1, 'REFILL_INVALID_COUNT'),
});
export type RefillPickedEmptiesInput = z.infer<typeof refillPickedEmptiesSchema>;

/** `PATCH /filling-orders/:id/filled` (assigned driver). The service checks `filledCount ≤ pickedUpEmptyCount`. */
export const refillFilledSchema = z.object({
  filledCount: z.number().int('REFILL_INVALID_COUNT').min(0, 'REFILL_INVALID_COUNT'),
});
export type RefillFilledInput = z.infer<typeof refillFilledSchema>;

/**
 * Refill station bodies (office, API_CONTRACT §7.2). `pricePerCylinderPaisa` is not a field any more:
 * refills carry no money (ADR-16), so a price sent by an old screen is dropped and the stored column is
 * left as it was.
 */
export const createFillingStationSchema = z.object({
  name: textSchema(1, 120),
  address: textSchema(1, 255),
  lat: latSchema,
  lng: lngSchema,
});
export type CreateFillingStationInput = z.infer<typeof createFillingStationSchema>;

export const updateFillingStationSchema = z
  .object({
    name: textSchema(1, 120).optional(),
    address: textSchema(1, 255).optional(),
    lat: latSchema.optional(),
    lng: lngSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine(requireBothCoordinates);
export type UpdateFillingStationInput = z.infer<typeof updateFillingStationSchema>;
