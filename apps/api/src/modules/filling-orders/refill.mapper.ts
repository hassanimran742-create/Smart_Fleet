import { Prisma, UserRole } from '@prisma/client';
import type { CylinderStateValue, FillingOrderDto, RefillCounts, RefillLineDto, RefillScanProgress } from '@smartfleet/shared-types';
import { deriveRefillStage, formatNo, legacyRefillCounts, refillLineCounts } from '@smartfleet/shared-utils';
import type { PolicyCaller } from '../../common/auth/policies';
import { sizeLabelOf } from '../pricing/size-label';

/**
 * Buttons a refill offers its caller (API_CONTRACT §1.6), from Inc 3 (§10.1):
 * - the office: ASSIGN while it waits for a driver (there is no office cancel, and no "Mark complete":
 *   the store's receive scans finish a refill);
 * - the owning shop: CANCEL while it is PENDING, or ASSIGNED with nothing picked up;
 * - the assigned driver: PICKUP (scan) while ASSIGNED and short of the request, LEAVE_STORE ("Done picking
 *   up", `advance → EMPTIES_PICKED`) once one is picked up, FILL (scan) while EMPTIES_PICKED or AT_STATION
 *   with a picked cylinder not yet filled, LEAVE_STATION ("Done filling", `advance → FILLED`) at the station
 *   after a fill. A FILLED refill waits for the shop's receive scans, so it offers the driver nothing.
 */
export type RefillAction = 'CANCEL' | 'ASSIGN' | 'PICKUP' | 'LEAVE_STORE' | 'FILL' | 'LEAVE_STATION';

/** What every refill DTO is built from: safe selects only (no user rows, no balance). */
export const REFILL_VIEW_INCLUDE = {
  distributor: { select: { id: true, businessName: true, code: true } },
  fillingStation: { select: { id: true, name: true } },
  cylinderType: { select: { id: true, code: true, name: true, weightKg: true } },
  assignedDriver: { select: { id: true, user: { select: { name: true, phone: true } } } },
  assignedVehicle: { select: { id: true, plateNo: true } },
  pickupStore: { select: { id: true, name: true } },
  // [Inc 3] The picked cylinders: the counts come from them, and one refill's answer lists them.
  cylinders: {
    select: {
      id: true,
      status: true,
      stateAtPickup: true,
      pickedUpAt: true,
      filledAt: true,
      returnedAt: true,
      cylinder: { select: { id: true, qrCode: true, shortNo: true, state: true } },
    },
    orderBy: [{ pickedUpAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.FillingOrderInclude;

export type RefillViewRow = Prisma.FillingOrderGetPayload<{ include: typeof REFILL_VIEW_INCLUDE }>;

/**
 * A refill as every route sends it: the FillingOrderDto (stage and counts, both prices "0", from Inc 3 the
 * refill number and, on the routes that show one refill, its picked cylinders) plus the fields installed
 * 0.1.0 apps read (`distributor`, `cylinderType`, `serviceType`, `updatedAt`, `pickupStore`).
 */
export type RefillView = FillingOrderDto & {
  distributor: { id: string; businessName: string; code: string };
  cylinderType: { id: string; code: string; name: string };
  pickupStore: { id: string; name: string } | null;
  serviceType: string;
  updatedAt: string;
};

/** The refill's human number ("AG-R007"), or null for a refill without one. */
export function refillShortCode(distributorCode: string | null | undefined, refillNo: number | null | undefined): string | null {
  if (refillNo === null || refillNo === undefined) return null;
  return formatNo(distributorCode ?? null, 'REFILL', refillNo);
}

/** The fields the counts are read from. */
export interface RefillCountsSource {
  status: string;
  requestedCount: number;
  pickedUpEmptyCount: number | null;
  filledCount: number | null;
  cylinders: ReadonlyArray<{ status: 'PICKED_UP' | 'FILLED' | 'RETURNED'; filledAt: Date | null }>;
}

/**
 * A refill's counts (API_CONTRACT §1.4): from Inc 3 they are counted from the picked cylinders (picked,
 * filled, received); a refill with no picked cylinder (one from before Inc 3, or none picked yet) reads
 * its legacy columns, which are empty for an Inc 3 refill.
 */
export function refillCountsOf(row: RefillCountsSource): RefillCounts {
  if (row.cylinders.length > 0) return refillLineCounts({ requestedCount: row.requestedCount, lines: row.cylinders });
  return legacyRefillCounts({
    status: row.status as never,
    requestedCount: row.requestedCount,
    pickedUpEmptyCount: row.pickedUpEmptyCount,
    filledCount: row.filledCount,
  });
}

/** What a refill scan answer and refusal carry as `progress` / `refill` (API_CONTRACT §10.1). */
export function refillProgressOf(row: RefillCountsSource): RefillScanProgress {
  return { type: 'REFILL', status: row.status as RefillScanProgress['status'], ...refillCountsOf(row) };
}

export function refillActions(
  row: { status: string; distributorId: string; assignedDriverId: string | null },
  counts: RefillCounts,
  unfilledOpen: number,
  caller: PolicyCaller,
): RefillAction[] {
  if (caller.role === UserRole.SUPER_ADMIN) return row.status === 'PENDING' ? ['ASSIGN'] : [];
  if (caller.role === UserRole.DISTRIBUTOR) {
    const owner = !!caller.distributorId && caller.distributorId === row.distributorId;
    const beforePickup = row.status === 'PENDING' || (row.status === 'ASSIGNED' && counts.picked === 0);
    return owner && beforePickup ? ['CANCEL'] : [];
  }
  if (caller.role === UserRole.DRIVER && caller.driverId && caller.driverId === row.assignedDriverId) {
    const actions: RefillAction[] = [];
    if (row.status === 'ASSIGNED') {
      if (counts.picked < counts.requested) actions.push('PICKUP');
      if (counts.picked >= 1) actions.push('LEAVE_STORE');
    } else if (row.status === 'EMPTIES_PICKED' || row.status === 'AT_STATION') {
      if (unfilledOpen > 0) actions.push('FILL');
      if (row.status === 'AT_STATION') actions.push('LEAVE_STATION');
    }
    return actions;
  }
  return [];
}

function toLineDto(row: RefillViewRow, line: RefillViewRow['cylinders'][number]): RefillLineDto {
  return {
    id: line.id,
    cylinder: {
      id: line.cylinder.id,
      code: line.cylinder.qrCode,
      shortNo: line.cylinder.shortNo,
      shortCode: line.cylinder.shortNo === null ? null : formatNo(row.distributor.code ?? null, 'CYLINDER', line.cylinder.shortNo),
      sizeLabel: sizeLabelOf(row.cylinderType),
      state: line.cylinder.state as CylinderStateValue,
    },
    status: line.status,
    stateAtPickup: line.stateAtPickup as CylinderStateValue,
    pickedUpAt: line.pickedUpAt.toISOString(),
    filledAt: line.filledAt ? line.filledAt.toISOString() : null,
    returnedAt: line.returnedAt ? line.returnedAt.toISOString() : null,
  };
}

/**
 * The DTO. `withCylinders` adds the picked cylinders and `assignedAt` (the routes that show one refill:
 * `GET /filling-orders/:id`, the scan, advance, assign and cancel answers); the lists leave them out.
 */
export function toRefillView(
  row: RefillViewRow,
  caller: PolicyCaller,
  opts: { withCylinders?: boolean; assignedAt?: Date | null } = {},
): RefillView {
  const counts = refillCountsOf(row);
  const unfilledOpen = row.cylinders.filter((line) => line.status === 'PICKED_UP').length;
  const view: RefillView = {
    id: row.id,
    distributorId: row.distributorId,
    status: row.status,
    stage: deriveRefillStage({ status: row.status, counts, increment: 3 }),
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
    shortCode: refillShortCode(row.distributor.code, row.refillNo),
    allowedActions: refillActions(row, counts, unfilledOpen, caller),
    refillNo: row.refillNo,
    pickedUpAt: row.pickedUpAt ? row.pickedUpAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    distributor: { id: row.distributor.id, businessName: row.distributor.businessName, code: row.distributor.code ?? '' },
    cylinderType: { id: row.cylinderType.id, code: row.cylinderType.code, name: row.cylinderType.name },
    pickupStore: row.pickupStore ? { id: row.pickupStore.id, name: row.pickupStore.name } : null,
    serviceType: row.serviceType,
    updatedAt: row.updatedAt.toISOString(),
  };
  if (opts.withCylinders) {
    view.cylinders = row.cylinders.map((line) => toLineDto(row, line));
    view.assignedAt = opts.assignedAt ? opts.assignedAt.toISOString() : null;
  }
  return view;
}
