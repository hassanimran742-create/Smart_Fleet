import { Prisma, UserRole } from '@prisma/client';
import type { FillingOrderDto } from '@smartfleet/shared-types';
import { deriveRefillStage, legacyRefillCounts } from '@smartfleet/shared-utils';
import type { PolicyCaller } from '../../common/auth/policies';
import { sizeLabelOf } from '../pricing/size-label';

/** Buttons a refill offers its caller (API_CONTRACT §1.6). Named after the Inc 1 routes. */
export type RefillAction = 'CANCEL' | 'ASSIGN' | 'COMPLETE' | 'PICKED_EMPTIES' | 'AT_STATION' | 'FILLED' | 'RETURNED';

/** What every refill DTO is built from: safe selects only (no user rows, no balance). */
export const REFILL_VIEW_INCLUDE = {
  distributor: { select: { id: true, businessName: true, code: true } },
  fillingStation: { select: { id: true, name: true } },
  cylinderType: { select: { id: true, code: true, name: true, weightKg: true } },
  assignedDriver: { select: { id: true, user: { select: { name: true, phone: true } } } },
  assignedVehicle: { select: { id: true, plateNo: true } },
  pickupStore: { select: { id: true, name: true } },
} satisfies Prisma.FillingOrderInclude;

export type RefillViewRow = Prisma.FillingOrderGetPayload<{ include: typeof REFILL_VIEW_INCLUDE }>;

/**
 * A refill as every route sends it: the FillingOrderDto (stage and counts from the legacy columns,
 * both prices "0") plus the fields installed 0.1.0 apps read (`distributor`, `cylinderType`,
 * `serviceType`, `updatedAt`, `pickupStore`).
 */
export type RefillView = FillingOrderDto & {
  distributor: { id: string; businessName: string; code: string };
  cylinderType: { id: string; code: string; name: string };
  pickupStore: { id: string; name: string } | null;
  serviceType: string;
  updatedAt: string;
};

export function refillActions(row: { status: string; distributorId: string; assignedDriverId: string | null }, caller: PolicyCaller): RefillAction[] {
  if (caller.role === UserRole.SUPER_ADMIN) {
    if (row.status === 'PENDING') return ['ASSIGN'];
    if (row.status === 'RETURNED') return ['COMPLETE'];
    return [];
  }
  if (caller.role === UserRole.DISTRIBUTOR) {
    return caller.distributorId === row.distributorId && (row.status === 'PENDING' || row.status === 'ASSIGNED') ? ['CANCEL'] : [];
  }
  if (caller.role === UserRole.DRIVER && caller.driverId && caller.driverId === row.assignedDriverId) {
    const next: Record<string, RefillAction | undefined> = {
      ASSIGNED: 'PICKED_EMPTIES',
      EMPTIES_PICKED: 'AT_STATION',
      AT_STATION: 'FILLED',
      FILLED: 'RETURNED',
    };
    const action = next[row.status];
    return action ? [action] : [];
  }
  return [];
}

export function toRefillView(row: RefillViewRow, caller: PolicyCaller): RefillView {
  const counts = legacyRefillCounts({
    status: row.status,
    requestedCount: row.requestedCount,
    pickedUpEmptyCount: row.pickedUpEmptyCount,
    filledCount: row.filledCount,
  });
  return {
    id: row.id,
    distributorId: row.distributorId,
    status: row.status,
    stage: deriveRefillStage({ status: row.status, counts, increment: 1 }),
    counts,
    cylinderTypeId: row.cylinderTypeId,
    sizeLabel: sizeLabelOf(row.cylinderType),
    fillingStation: row.fillingStation ? { id: row.fillingStation.id, name: row.fillingStation.name } : null,
    requestedCount: row.requestedCount,
    pickedUpEmptyCount: row.pickedUpEmptyCount,
    filledCount: row.filledCount,
    // Refills carry no money (ADR-16): the station price is ignored and returned as 0.
    pricePerCylinderPaisa: '0',
    totalCostPaisa: '0',
    assignedDriver: row.assignedDriver
      ? { id: row.assignedDriver.id, name: row.assignedDriver.user.name, phone: row.assignedDriver.user.phone }
      : null,
    assignedVehicle: row.assignedVehicle ? { id: row.assignedVehicle.id, plateNo: row.assignedVehicle.plateNo } : null,
    pickupStoreId: row.pickupStoreId,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    shortCode: null,
    allowedActions: refillActions(row, caller),
    distributor: { id: row.distributor.id, businessName: row.distributor.businessName, code: row.distributor.code ?? '' },
    cylinderType: { id: row.cylinderType.id, code: row.cylinderType.code, name: row.cylinderType.name },
    pickupStore: row.pickupStore ? { id: row.pickupStore.id, name: row.pickupStore.name } : null,
    serviceType: row.serviceType,
    updatedAt: row.updatedAt.toISOString(),
  };
}
