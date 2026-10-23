import type { IdName, IsoDateTime, Paisa, UUID } from './common.types';

/** Mirrors Prisma `FillingOrderStatus`. RETURNED is Inc 1 only; FAILED is legacy. */
export const FillingOrderStatus = {
  PENDING: 'PENDING',
  ASSIGNED: 'ASSIGNED',
  EMPTIES_PICKED: 'EMPTIES_PICKED',
  AT_STATION: 'AT_STATION',
  FILLED: 'FILLED',
  RETURNED: 'RETURNED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
} as const;
export type FillingOrderStatus = (typeof FillingOrderStatus)[keyof typeof FillingOrderStatus];

/**
 * The stage people see for a refill, derived by `deriveRefillStage` in shared-utils (API_CONTRACT §1.4)
 * and sent as `stage` on every refill DTO from Inc 1. Listed in lifecycle order. The shop app maps it
 * to `stages.refill.<STAGE>`, the website to its own words (UX_MOBILE §8.1, UX_ADMIN §4.1).
 */
export const REFILL_STAGES = [
  'NEEDS_DRIVER',
  'DRIVER_ASSIGNED',
  'PICKING_UP',
  'PICKED_UP',
  'AT_STATION',
  'COMING_BACK',
  'BACK_AT_STORE',
  'DONE',
  'CANCELLED',
] as const;
export type RefillStage = (typeof REFILL_STAGES)[number];

/**
 * How many cylinders a refill has at each step (API_CONTRACT §1.4). Inc 1 reads the legacy columns
 * (`requestedCount`, `pickedUpEmptyCount`, `filledCount`; missing = 0; received = picked once the
 * status is RETURNED or COMPLETED); Inc 3 counts the lines.
 */
export interface RefillCounts {
  requested: number;
  picked: number;
  filled: number;
  received: number;
}

/** [Inc 3] Refill scan answers and refusals carry the refill's counts as their progress (API_CONTRACT §10.1). */
export interface RefillScanProgress extends RefillCounts {
  type: 'REFILL';
  status: FillingOrderStatus;
}

/**
 * A refill request on every refill route (`GET /filling-orders/mine`, `/driver/mine`, the office list
 * and `GET /filling-orders/:id`; API_CONTRACT §7.11). Refills carry no money: both price fields are
 * always "0". Installed 0.1.0 apps read the legacy fields; new screens read `stage` and `counts`.
 */
export interface FillingOrderDto {
  id: UUID;
  distributorId: UUID;
  status: FillingOrderStatus;
  stage: RefillStage;
  counts: RefillCounts;
  cylinderTypeId: UUID;
  /** For example "11.8 kg". */
  sizeLabel: string;
  fillingStation: IdName | null;
  requestedCount: number;
  pickedUpEmptyCount: number | null;
  filledCount: number | null;
  /** Always "0" (ADR-16). */
  pricePerCylinderPaisa: Paisa;
  /** Always "0" (ADR-16). */
  totalCostPaisa: Paisa;
  assignedDriver: { id: UUID; name: string; phone: string } | null;
  assignedVehicle: { id: UUID; plateNo: string } | null;
  pickupStoreId: UUID | null;
  cancellationReason: string | null;
  createdAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  /** From Inc 3 (`refill_no`): "AG-R007". Null in Inc 1. */
  shortCode?: string | null;
  /** Buttons the server allows (API_CONTRACT §1.6); the refill action names are the api-orders lane's. */
  allowedActions?: string[];
}
