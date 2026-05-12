import type { GeoPoint, ISODateString, Paisa, UUID } from './common.types';

export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  ASSIGNED = 'ASSIGNED',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

export enum OrderPaymentStatus {
  UNPAID = 'UNPAID',
  PAID_VIA_LEDGER = 'PAID_VIA_LEDGER',
  PAID_DIRECT = 'PAID_DIRECT',
}

export interface OrderLine {
  cylinderTypeId: UUID;
  fullCount: number;
  expectedReturnCount: number;
}

export interface Order {
  id: UUID;
  distributorId: UUID;
  clientId: UUID;
  deliveryLocation: GeoPoint;
  deliveryLabel: string;
  destZoneId: UUID;
  originStoreId?: UUID;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  deliveryFeePaisa: Paisa;
  scheduledWindowStart?: ISODateString;
  scheduledWindowEnd?: ISODateString;
  lines: OrderLine[];
  tripId?: UUID;
  createdAt: ISODateString;
}
