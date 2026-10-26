import { z } from 'zod';
import { textSchema, uuidSchema } from './common.schema';
import { VEHICLE_STATUSES } from './internal/codes';

/** `POST /vehicles` (office) `{ plateNo, capacityUnits, homeZoneId }`; the plate is kept upper-case. */
export const createVehicleSchema = z.object({
  plateNo: textSchema(1, 20).transform((plate) => plate.toUpperCase()),
  capacityUnits: z.number().int().min(1).max(1000),
  homeZoneId: uuidSchema,
});
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

/** `PATCH /vehicles/:id` (office): any of the create fields. */
export const updateVehicleSchema = createVehicleSchema.partial();
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;

/** `PATCH /vehicles/:id/status` (office) `{ status }`. */
export const vehicleStatusSchema = z.object({ status: z.enum(VEHICLE_STATUSES) });
export type VehicleStatusInput = z.infer<typeof vehicleStatusSchema>;

/** `PATCH /vehicles/:id/zone` (office) `{ homeZoneId }`. */
export const vehicleZoneSchema = z.object({ homeZoneId: uuidSchema });
export type VehicleZoneInput = z.infer<typeof vehicleZoneSchema>;
