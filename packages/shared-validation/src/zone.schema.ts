import { z } from 'zod';
import { booleanQuerySchema, textSchema, uuidSchema } from './common.schema';

/** A GeoJSON position `[lng, lat]` (an optional third number, such as an altitude, is dropped). */
const positionSchema = z
  .array(z.number().finite())
  .min(2)
  .max(3)
  .superRefine((position, ctx) => {
    const [lng, lat] = position;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'INVALID_LOCATION' });
    }
  })
  .transform((position): [number, number] => [position[0], position[1]]);

/** A closed ring: at least four positions, the last equal to the first. */
const ringSchema = z
  .array(positionSchema)
  .min(4)
  .superRefine((ring, ctx) => {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'INVALID_VALUE' });
    }
  });

/**
 * A zone's shape: a non-empty GeoJSON MultiPolygon (API_CONTRACT §7.2). This checks the structure only;
 * the service checks the geometry itself (`ST_IsValid`, area > 0) and answers `ZONE_INVALID_SHAPE`.
 */
export const multiPolygonSchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(ringSchema).min(1)).min(1).max(500),
});
export type MultiPolygonInput = z.infer<typeof multiPolygonSchema>;

/** `POST /zones` (office) → 201 `{ id }`. An unknown `cityId` is 404 `NOT_FOUND` `{field: 'cityId'}`. */
export const createZoneSchema = z.object({
  cityId: uuidSchema,
  name: textSchema(2, 60),
  polygonGeoJson: multiPolygonSchema,
});
export type CreateZoneInput = z.infer<typeof createZoneSchema>;

/**
 * `PATCH /zones/:id` (office) → 200 `{ ok: true }`. `isActive` is dropped (archive and reactivate have
 * their own routes); so is any other unknown field.
 */
export const updateZoneSchema = z.object({
  name: textSchema(2, 60).optional(),
  polygonGeoJson: multiPolygonSchema.optional(),
});
export type UpdateZoneInput = z.infer<typeof updateZoneSchema>;

/** `GET /zones/city/:cityId?includeArchived=true` (only the office may include archived zones). */
export const zonesQuerySchema = z.object({
  includeArchived: booleanQuerySchema.optional(),
});
export type ZonesQuery = z.infer<typeof zonesQuerySchema>;

/** `POST /cities` (office) `{ name, countryCode? }`: a two-letter country code, kept upper-case. */
export const createCitySchema = z.object({
  name: textSchema(1, 80),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'INVALID_FORMAT').optional(),
});
export type CreateCityInput = z.infer<typeof createCitySchema>;
