import type { GeoPoint, ISODateString, UUID } from './common.types';

export interface Driver {
  id: UUID;
  userId: UUID;
  licenceNo: string;
  currentVehicleId?: UUID;
  currentZoneId?: UUID;
  currentLocation?: GeoPoint;
  currentLocationUpdatedAt?: ISODateString;
  isOnline: boolean;
}
