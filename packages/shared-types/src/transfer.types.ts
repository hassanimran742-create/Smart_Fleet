import type { ISODateString, UUID } from './common.types';

export enum TransferStatus {
  REQUESTED = 'REQUESTED',
  IN_TRANSIT = 'IN_TRANSIT',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export interface Transfer {
  id: UUID;
  fromStoreId: UUID;
  toStoreId: UUID;
  vehicleId?: UUID;
  status: TransferStatus;
  requestedBy: UUID;
  cylinderIds: UUID[];
  createdAt: ISODateString;
  completedAt?: ISODateString;
}
