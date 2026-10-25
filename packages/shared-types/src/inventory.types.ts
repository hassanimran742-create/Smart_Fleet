import type { UUID } from './common.types';
import type { CustodyType, CylinderState, CylinderStateValue } from './cylinder.types';

export interface InventoryLot {
  id: UUID;
  holderType: CustodyType;
  holderId: UUID;
  distributorId: UUID;
  cylinderTypeId: UUID;
  state: CylinderState;
  count: number;
}

/** One size on a van, counted from the cylinders (`GET /inventory/my-vehicle` and the office's vehicle summaries). */
export interface VehicleLoadSize {
  cylinderTypeId: UUID;
  code: string;
  name: string;
  full: number;
  empty: number;
  partFilled: number;
}

/** [Inc 2] A cylinder on the driver's van by its number, for My van's numbers line (UX_MOBILE §7.2 R9). */
export interface VanCylinderCode {
  /** "AG-C0042"; the QR value for a cylinder without a short number. */
  shortCode: string;
  cylinderTypeId: UUID;
  state: CylinderStateValue;
}

/**
 * `GET /inventory/my-vehicle` (DRIVER): the driver's current van, counted from its cylinders (API_CONTRACT
 * Appendix A). Damaged or lost cylinders count in none of the three totals. `noVehicle` is set when the
 * office hasn't given the driver a van; `cylinders` is then empty.
 */
export interface MyVehicleLoadDto {
  vehicleId: UUID | null;
  plateNo: string | null;
  totalFull: number;
  totalEmpty: number;
  totalPartFilled: number;
  byType: VehicleLoadSize[];
  /** [Inc 2] Every cylinder on the van, numbers in order (damaged and lost ones included, with their state). */
  cylinders: VanCylinderCode[];
  noVehicle?: true;
}
