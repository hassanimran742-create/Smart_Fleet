import { z } from 'zod';

export const geoPointSchema = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
});

export const orderLineSchema = z.object({
  cylinderTypeId: z.string().uuid(),
  fullCount: z.number().int().min(1).max(100),
  expectedReturnCount: z.number().int().min(0).max(100),
});

export const createOrderSchema = z.object({
  clientId: z.string().uuid(),
  deliveryLocation: geoPointSchema,
  deliveryLabel: z.string().min(1).max(255),
  lines: z.array(orderLineSchema).min(1).max(20),
  scheduledWindowStart: z.string().datetime().optional(),
  scheduledWindowEnd: z.string().datetime().optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const updateOrderStatusSchema = z.object({
  status: z.enum([
    'PENDING',
    'CONFIRMED',
    'ASSIGNED',
    'IN_TRANSIT',
    'DELIVERED',
    'CANCELLED',
    'FAILED',
  ]),
  reason: z.string().max(500).optional(),
});
