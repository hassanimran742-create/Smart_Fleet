import { z } from 'zod';
import { isoDateTimeSchema, optionalTextSchema, paisaSchema, uuidSchema } from './common.schema';

/**
 * `POST /fuel-refills` (DRIVER exact, behind `features.fuelRefills`): today's body, API_CONTRACT §7.2.
 * The driver comes from the token; a `driverId` in the body is dropped.
 */
export const createFuelRefillSchema = z.object({
  vehicleId: uuidSchema,
  litres: z.number().finite().positive().max(1000),
  costPaisa: paisaSchema(),
  odometerKm: z.number().int().min(0).max(10_000_000),
  fuelStation: optionalTextSchema(120),
  notes: optionalTextSchema(300),
});
export type CreateFuelRefillInput = z.infer<typeof createFuelRefillSchema>;

/** `GET /fuel-refills?since=` (office): an ISO instant. */
export const fuelRefillsQuerySchema = z.object({ since: isoDateTimeSchema.optional() });
export type FuelRefillsQuery = z.infer<typeof fuelRefillsQuerySchema>;
