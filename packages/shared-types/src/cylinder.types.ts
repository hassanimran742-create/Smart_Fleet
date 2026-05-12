import type { UUID } from './common.types';

export enum CylinderState {
  FULL = 'FULL',
  EMPTY = 'EMPTY',
  FAULTY = 'FAULTY',
  LOST = 'LOST',
}

export enum CustodyType {
  DISTRIBUTOR = 'DISTRIBUTOR',
  STORE = 'STORE',
  VEHICLE = 'VEHICLE',
  CLIENT = 'CLIENT',
}

export enum CylinderEventType {
  SCAN_IN = 'SCAN_IN',
  SCAN_OUT = 'SCAN_OUT',
  DELIVERED = 'DELIVERED',
  PICKED_UP_EMPTY = 'PICKED_UP_EMPTY',
  RETURNED_TO_DISTRIBUTOR = 'RETURNED_TO_DISTRIBUTOR',
  TRANSFER = 'TRANSFER',
  MARK_FAULTY = 'MARK_FAULTY',
  MARK_LOST = 'MARK_LOST',
}

export interface CylinderType {
  id: UUID;
  code: string;
  name: string;
  weightKg: number;
  capacityUnits: number;
}

export interface Cylinder {
  id: UUID;
  serial: string;
  qrCode: string;
  distributorId: UUID;
  cylinderTypeId: UUID;
  state: CylinderState;
  custodyType: CustodyType;
  custodyId: UUID;
}

export interface CylinderEvent {
  id: UUID;
  cylinderId: UUID;
  eventType: CylinderEventType;
  fromCustodyType: CustodyType | null;
  fromCustodyId: UUID | null;
  toCustodyType: CustodyType | null;
  toCustodyId: UUID | null;
  actorUserId: UUID;
  photoUrl?: string;
  tripId?: UUID;
  orderId?: UUID;
  transferId?: UUID;
  createdAt: string;
}
