import type { UUID } from './common.types';

export enum VehicleStatus {
  ACTIVE = 'ACTIVE',
  MAINTENANCE = 'MAINTENANCE',
  RETIRED = 'RETIRED',
}

export interface Vehicle {
  id: UUID;
  plateNo: string;
  capacityUnits: number; // measured in 11kg-cylinder equivalents
  homeZoneId: UUID;
  currentDriverId?: UUID;
  status: VehicleStatus;
}
