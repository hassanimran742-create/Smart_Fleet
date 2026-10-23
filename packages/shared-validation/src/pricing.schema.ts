import { z } from 'zod';
import { optionalTextSchema, paisaSchema, reasonSchema, uuidSchema } from './common.schema';

/** The largest delivery price amount, base or per size: Rs 100,000 (API_CONTRACT §7.5). */
export const PRICE_MAX_PAISA = 10_000_000;

/**
 * A delivery price amount: whole rupees from Rs 0 to Rs 100,000 inclusive. Every bad amount (negative,
 * paisa, not a whole number, not a number, too large) is `PRICE_INVALID` (API_CONTRACT §7.5); only a
 * missing one is `REQUIRED`.
 */
export const priceAmountSchema = paisaSchema({ wholeRupees: true, maxPaisa: PRICE_MAX_PAISA, code: 'PRICE_INVALID' });

/**
 * `PUT /pricing/prices/:distributorId/:zoneId` (office). Sizes are optional and a missing size costs 0;
 * each size appears once. The service checks the zone is active (`ZONE_ARCHIVED`).
 */
export const putPriceSchema = z.object({
  basePaisa: priceAmountSchema,
  sizes: z
    .array(z.object({ cylinderTypeId: uuidSchema, perCylinderPaisa: priceAmountSchema }))
    .max(20)
    .superRefine((sizes, ctx) => {
      const seen = new Set<string>();
      sizes.forEach((size, index) => {
        if (seen.has(size.cylinderTypeId)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'cylinderTypeId'], message: 'DUPLICATE_ITEM' });
        }
        seen.add(size.cylinderTypeId);
      });
    })
    .optional(),
  note: optionalTextSchema(200),
});
export type PutPriceInput = z.infer<typeof putPriceSchema>;

/** `DELETE /pricing/prices/:distributorId/:zoneId` (office) `{ reason }`. The zone is blocked again. */
export const removePriceSchema = z.object({
  reason: reasonSchema,
});
export type RemovePriceInput = z.infer<typeof removePriceSchema>;

/** `GET /pricing/quote?lat&lng` (distributor); the office adds `&distributorId`. */
export const locationQuoteQuerySchema = z.object({
  lat: z.coerce.number().finite().min(-90).max(90),
  lng: z.coerce.number().finite().min(-180).max(180),
  distributorId: uuidSchema.optional(),
});
export type LocationQuoteQuery = z.infer<typeof locationQuoteQuerySchema>;

/**
 * The frozen legacy `POST /pricing/rules` body (zone-pair pricing, `pricing_rules`), kept with today's
 * fields so the office's old screen keeps working and a bad body answers 400 instead of a database
 * error. No quote, order or fee reads these rules (API_CONTRACT §5.1, §7.2); the table and the route go
 * after the pilot.
 */
export const legacyPricingRuleSchema = z.object({
  cityId: uuidSchema,
  originZoneId: uuidSchema,
  destZoneId: uuidSchema,
  cylinderTypeId: uuidSchema,
  basePaisa: paisaSchema(),
  perUnitPaisa: paisaSchema(),
});
export type LegacyPricingRuleInput = z.infer<typeof legacyPricingRuleSchema>;
