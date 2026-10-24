import type { IdName, IsoDateTime, Paisa, UUID } from './common.types';
import type { CylinderStateValue, ScanEntryMethod, ScanResult } from './cylinder.types';

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
 * [Inc 3] Mirrors Prisma `FillingOrderCylinderStatus`: one picked cylinder of a refill
 * (`filling_order_cylinders`). PICKED_UP by the pickup scan, FILLED by the fill scan at the station,
 * RETURNED by the store's receive scan, filled or not (a returned line keeps `filledAt` when it was
 * filled). The refill completes when every picked line is RETURNED (ADR-16, G08-07).
 */
export const FillingOrderCylinderStatus = {
  PICKED_UP: 'PICKED_UP',
  FILLED: 'FILLED',
  RETURNED: 'RETURNED',
} as const;
export type FillingOrderCylinderStatus = (typeof FillingOrderCylinderStatus)[keyof typeof FillingOrderCylinderStatus];

/**
 * [Inc 3] A refill line that still holds its cylinder for the refill: PICKED_UP or FILLED, on a refill
 * that isn't COMPLETED or CANCELLED (API_CONTRACT §10.1). Such a cylinder can't be picked up for another
 * refill, and it doesn't count as a leftover on a delivery run's van (§9.3, §9.9).
 */
export const OPEN_REFILL_LINE_STATUSES = ['PICKED_UP', 'FILLED'] as const satisfies readonly FillingOrderCylinderStatus[];

/** [Inc 3] The two driver scans of a refill run (`POST /filling-orders/:id/scans`). */
export const REFILL_SCAN_PHASES = ['PICKUP', 'FILL'] as const;
export type RefillScanPhase = (typeof REFILL_SCAN_PHASES)[number];

/**
 * [Inc 3] `POST /filling-orders/:id/advance` `{ to }`: EMPTIES_PICKED is "Leave store" (ASSIGNED with at
 * least one picked line), FILLED is "Leave station" (AT_STATION, at least one fill). Asking for the
 * status the refill already has answers 200 `X-Already-Applied`; anything else 409 `REFILL_WRONG_STEP`.
 */
export const REFILL_ADVANCE_TARGETS = ['EMPTIES_PICKED', 'FILLED'] as const;
export type RefillAdvanceTarget = (typeof REFILL_ADVANCE_TARGETS)[number];

/** [Inc 3] `POST /filling-orders/:id/scans` once the body is checked (the assigned driver). */
export interface RefillScanRequest {
  scanId: UUID;
  phase: RefillScanPhase;
  code: string;
  entryMethod: ScanEntryMethod;
  lat?: number;
  lng?: number;
}

/**
 * [Inc 3] The answer of a refill scan (API_CONTRACT §10.1): the `ScanResult` (201 RECORDED; 200
 * ALREADY_RECORDED with `Idempotent-Replay` for a resend, or `X-Already-Applied` for the same move under
 * a new scan id, which never raises the counts) with `stop: null`, plus the refill's counts now. The
 * scan's action is REFILL_PICKUP or REFILL_FILL.
 */
export interface RefillScanResult extends ScanResult {
  refill: { status: FillingOrderStatus; picked: number; filled: number; received: number; requested: number };
}

/** [Inc 3] One picked cylinder of a refill, for the refill's cylinder list (shop, driver and office). */
export interface RefillLineDto {
  id: UUID;
  cylinder: {
    id: UUID;
    /** The QR value. */
    code: string;
    shortNo: number | null;
    /** "AG-C0042"; null without a short number. */
    shortCode: string | null;
    sizeLabel: string;
    /** The cylinder's state now (FULL once received after a fill). */
    state: CylinderStateValue;
  };
  status: FillingOrderCylinderStatus;
  /** EMPTY or PART_FILLED. */
  stateAtPickup: CylinderStateValue;
  pickedUpAt: IsoDateTime;
  filledAt: IsoDateTime | null;
  returnedAt: IsoDateTime | null;
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
  /**
   * Buttons the server allows (API_CONTRACT §1.6). The action names belong to the refills module
   * (`RefillAction` in modules/filling-orders/refill.mapper.ts).
   */
  allowedActions?: string[];
  /** [Inc 3] `refill_no`, numbered per distributor from `next_refill_no` (the number in `shortCode`). */
  refillNo?: number | null;
  /** [Inc 3] The first pickup scan; from then on the owner can't cancel. */
  pickedUpAt?: IsoDateTime | null;
  /** [Inc 3] The owner's cancel (only before pickup). */
  cancelledAt?: IsoDateTime | null;
  /**
   * [Inc 3] The refill's picked cylinders, oldest pickup first, on the routes that show one refill
   * (`GET /filling-orders/:id`, the scan and advance answers). Lists leave it out. From Inc 3 `counts`
   * are counted from these lines (`refillLineCounts` in shared-utils); a refill with no line (an Inc 1
   * one) keeps its legacy counts.
   */
  cylinders?: RefillLineDto[];
}
