import type { GeoPoint, UUID } from './common.types';

export interface Store {
  id: UUID;
  name: string;
  zoneId: UUID;
  address: string;
  location: GeoPoint;
  isActive: boolean;
}
