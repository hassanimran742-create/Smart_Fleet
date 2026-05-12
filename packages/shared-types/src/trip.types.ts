import type { GeoPoint, ISODateString, UUID } from './common.types';

export enum TripStatus {
  PLANNED = 'PLANNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  ABORTED = 'ABORTED',
}

export enum TripStopType {
  STORE_PICKUP = 'STORE_PICKUP',
  DELIVERY = 'DELIVERY',
  RETURN_DROPOFF = 'RETURN_DROPOFF',
}

export interface TripStop {
  id: UUID;
  tripId: UUID;
  orderId?: UUID;
  seq: number;
  stopType: TripStopType;
  location: GeoPoint;
  etaAt?: ISODateString;
  arrivedAt?: ISODateString;
  departedAt?: ISODateString;
  notes?: string;
}

export interface Trip {
  id: UUID;
  driverId: UUID;
  vehicleId: UUID;
  originStoreId: UUID;
  status: TripStatus;
  stops: TripStop[];
  plannedAt: ISODateString;
  startedAt?: ISODateString;
  completedAt?: ISODateString;
}
