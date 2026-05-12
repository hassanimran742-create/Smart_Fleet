import { z } from 'zod';
import { geoPointSchema } from './order.schema';

export const scanEventSchema = z.object({
  qrCode: z.string().min(8).max(128),
  eventType: z.enum([
    'SCAN_IN',
    'SCAN_OUT',
    'DELIVERED',
    'PICKED_UP_EMPTY',
    'RETURNED_TO_DISTRIBUTOR',
    'TRANSFER',
    'MARK_FAULTY',
    'MARK_LOST',
  ]),
  location: geoPointSchema.optional(),
  photoUrl: z.string().url().optional(),
  tripId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  transferId: z.string().uuid().optional(),
  toCustodyType: z.enum(['DISTRIBUTOR', 'STORE', 'VEHICLE', 'CLIENT']).optional(),
  toCustodyId: z.string().uuid().optional(),
});
export type ScanEventInput = z.infer<typeof scanEventSchema>;
