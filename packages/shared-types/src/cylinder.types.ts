import type { IsoDateTime, UUID } from './common.types';
import type { StopProgress, TripStatusValue, TripStopTypeValue } from './trip.types';

/** Mirrors Prisma `CylinderState`. PART_FILLED [Inc 2] is a taken-back cylinder neither full nor empty. */
export enum CylinderState {
  FULL = 'FULL',
  EMPTY = 'EMPTY',
  FAULTY = 'FAULTY',
  LOST = 'LOST',
  PART_FILLED = 'PART_FILLED',
}

/** The wire value of a {@link CylinderState}. A string union, so Prisma's enum values are assignable to it. */
export type CylinderStateValue = `${CylinderState}`;

/** Mirrors Prisma `CustodyType`. DISTRIBUTOR is legacy: nothing new writes it (DATA_MODEL §4.1). */
export enum CustodyType {
  DISTRIBUTOR = 'DISTRIBUTOR',
  STORE = 'STORE',
  VEHICLE = 'VEHICLE',
  CLIENT = 'CLIENT',
}

/** The wire value of a {@link CustodyType}. */
export type CustodyTypeValue = `${CustodyType}`;

/**
 * Mirrors Prisma `CylinderEventType`. The driver's words read backwards from these codes (README):
 * Load = SCAN_OUT, Deliver = DELIVERED, Take back = PICKED_UP_EMPTY, the store's receive = SCAN_IN.
 * REGISTERED [Inc 2] is a bulk registration into the home store. RETURNED_TO_DISTRIBUTOR is legacy.
 */
export enum CylinderEventType {
  SCAN_IN = 'SCAN_IN',
  SCAN_OUT = 'SCAN_OUT',
  DELIVERED = 'DELIVERED',
  PICKED_UP_EMPTY = 'PICKED_UP_EMPTY',
  RETURNED_TO_DISTRIBUTOR = 'RETURNED_TO_DISTRIBUTOR',
  TRANSFER = 'TRANSFER',
  MARK_FAULTY = 'MARK_FAULTY',
  MARK_LOST = 'MARK_LOST',
  REGISTERED = 'REGISTERED',
}

/** The wire value of a {@link CylinderEventType}. */
export type CylinderEventTypeValue = `${CylinderEventType}`;

/**
 * [Inc 2] Mirrors Prisma `CylinderEventSource`: how a move was recorded. TYPED is a cylinder number
 * typed in (logged, audit `custody.typed_entry`); MANUAL is the office, with a reason.
 */
export const CylinderEventSource = {
  SCAN: 'SCAN',
  TYPED: 'TYPED',
  MANUAL: 'MANUAL',
  REGISTRATION: 'REGISTRATION',
} as const;
export type CylinderEventSource = (typeof CylinderEventSource)[keyof typeof CylinderEventSource];

/** [Inc 2] Mirrors Prisma `StopCylinderDirection`: the two per-visit lists of a DELIVERY stop. */
export const StopCylinderDirection = {
  GIVEN: 'GIVEN',
  TAKEN_BACK: 'TAKEN_BACK',
} as const;
export type StopCylinderDirection = (typeof StopCylinderDirection)[keyof typeof StopCylinderDirection];

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
  /** [Inc 2] The number on the label (AG-C0042); null for a cylinder registered before Inc 2 and not yet numbered. */
  shortNo?: number | null;
  state: CylinderState;
  custodyType: CustodyType;
  custodyId: UUID;
  /** [Inc 2] The last move. */
  lastEventId?: UUID | null;
}

export interface CylinderEvent {
  id: UUID;
  cylinderId: UUID;
  eventType: CylinderEventType;
  /** [Inc 2] SCAN for every event written before Inc 2. */
  source?: CylinderEventSource;
  fromCustodyType: CustodyType | null;
  fromCustodyId: UUID | null;
  toCustodyType: CustodyType | null;
  toCustodyId: UUID | null;
  /** [Inc 2] The state before and after the move (null on older events). */
  fromState?: CylinderState | null;
  toState?: CylinderState | null;
  /** [Inc 2] Why: required for MANUAL. */
  reason?: string | null;
  actorUserId: UUID;
  /** [Inc 2] The app's scan id. */
  clientScanId?: UUID | null;
  photoUrl?: string;
  tripId?: UUID;
  /** [Inc 2] The stop of the move. */
  tripStopId?: UUID | null;
  orderId?: UUID;
  transferId?: UUID;
  createdAt: string;
}

// ---------- Inc 2: scans (API_CONTRACT §9.2-§9.5) ----------

/**
 * [Inc 2] The moves `ScanService.apply` handles (API_CONTRACT §5.9). REFILL_PICKUP and REFILL_FILL come
 * in Inc 3. Each is one event code: LOAD SCAN_OUT, HANDOVER DELIVERED, TAKE_BACK PICKED_UP_EMPTY,
 * STORE_RECEIVE SCAN_IN, OFFICE_MANUAL_DELIVERY DELIVERED (source MANUAL), REGISTER REGISTERED.
 */
export const SCAN_ACTIONS = [
  'LOAD',
  'HANDOVER',
  'TAKE_BACK',
  'STORE_RECEIVE',
  'OFFICE_MANUAL_DELIVERY',
  'REGISTER',
  'REFILL_PICKUP',
  'REFILL_FILL',
] as const;
export type ScanAction = (typeof SCAN_ACTIONS)[number];

/** [Inc 2] The actions a driver scans at a stop (`POST /trips/:tripId/scans`). */
export const DRIVER_SCAN_ACTIONS = ['LOAD', 'HANDOVER', 'TAKE_BACK'] as const;
export type DriverScanAction = (typeof DRIVER_SCAN_ACTIONS)[number];

/** [Inc 2] How a cylinder number reached the server: a QR read, or typed (refused while `custody.typedEntry.enabled` is off). */
export const SCAN_ENTRY_METHODS = ['QR', 'TYPED'] as const;
export type ScanEntryMethod = (typeof SCAN_ENTRY_METHODS)[number];

/** [Inc 2] RECORDED for a new move; ALREADY_RECORDED for a resend (same scan id) or the same move again. */
export type ScanOutcome = 'RECORDED' | 'ALREADY_RECORDED';

/** [Inc 2] Where a cylinder is now, in words the apps show (`label`: the store's name, the plate, the customer's name). */
export interface CylinderHolderDto {
  type: Exclude<CustodyTypeValue, 'DISTRIBUTOR'>;
  label: string;
}

/** [Inc 2] The cylinder on a scan answer. */
export interface ScannedCylinderDto {
  id: UUID;
  /** The QR value. */
  code: string;
  shortNo: number | null;
  /** `formatNo(code, 'CYLINDER', shortNo)`, for example "AG-C0042"; null without a short number. */
  shortCode: string | null;
  size: { id: UUID; label: string };
  state: CylinderStateValue;
  holder: CylinderHolderDto;
}

/**
 * [Inc 2] The answer of every scan (API_CONTRACT §9.3): 201 RECORDED for a new move; 200
 * ALREADY_RECORDED with `Idempotent-Replay` (same scan id) or `X-Already-Applied` (the same move under a
 * new scan id). `scan` is the recorded scan, `cylinder` and `progress` are as they are now. A store
 * scan has no stop (`stop: null`).
 */
export interface ScanResult {
  result: ScanOutcome;
  scan: { scanId: UUID | null; action: ScanAction; at: IsoDateTime };
  cylinder: ScannedCylinderDto;
  stop: { id: UUID; type: TripStopTypeValue; progress: StopProgress } | null;
}

/** [Inc 2] A count per size (store figures, received today). */
export interface SizeCount {
  cylinderTypeId: UUID;
  sizeLabel: string;
  count: number;
}

/** [Inc 2] `POST /store/scans` (DISTRIBUTOR exact; the action is STORE_RECEIVE). */
export interface StoreScanResult extends ScanResult {
  /** The van it came off; null when that can't be told (an old move). */
  fromVan: { plateNo: string; driver: { id: UUID; name: string } | null } | null;
  /** What the store has received today (the current business day). */
  receivedToday: { count: number; bySize: SizeCount[] };
}

/** [Inc 2] Why a cylinder is on a van: taken back from a customer, loaded and not delivered, a spare, or (Inc 3) a refill. */
export type VanCylinderCame = 'TAKEN_BACK' | 'NOT_DELIVERED' | 'SPARE' | 'REFILL';

/** [Inc 2] `GET /store/incoming` (DISTRIBUTOR exact): the caller's cylinders on any van. Unlabelled returns never appear. */
export interface StoreIncomingDto {
  vans: {
    vehicle: { id: UUID; plateNo: string };
    driver: { id: UUID; name: string; phone: string } | null;
    trip: { id: UUID; status: TripStatusValue } | null;
    cylinders: {
      shortCode: string | null;
      sizeLabel: string;
      state: CylinderStateValue;
      came: VanCylinderCame;
      from: { clientName: string; orderShortCode: string } | null;
      /** Inc 3. */
      refill: { shortCode: string } | null;
    }[];
    counts: { total: number; received: number; bySize: SizeCount[] };
  }[];
}

/** [Inc 2] `GET /store/stock` (DISTRIBUTOR exact): what is in the store, counted from cylinders (not `inventory_lots`). */
export interface StoreStockDto {
  total: number;
  sizes: {
    cylinderTypeId: UUID;
    sizeLabel: string;
    total: number;
    byState: Record<CylinderStateValue, number>;
  }[];
}

/**
 * [Inc 2] `GET /cylinders/:code/history` (DISTRIBUTOR or office). `responsible` is the driver of the
 * newest move onto a van since the cylinder last entered a store (API_CONTRACT §9.2): null while it is
 * in a store, and when no such move exists.
 */
export interface CylinderHistoryDto {
  cylinder: { id: UUID; code: string; shortNo: number | null; shortCode: string | null; size: { id: UUID; label: string }; state: CylinderStateValue };
  holder: {
    type: Exclude<CustodyTypeValue, 'DISTRIBUTOR'>;
    label: string;
    since: IsoDateTime | null;
    responsible: { userId: UUID; name: string; role: 'DRIVER' } | null;
  };
  events: {
    at: IsoDateTime;
    action: CylinderEventTypeValue;
    /** Holder labels. */
    from: string | null;
    to: string | null;
    actor: { name: string; role: string };
    order: { shortCode: string } | null;
    refill: { shortCode: string } | null;
    source: CylinderEventSource;
    returnState: CylinderStateValue | null;
    reason: string | null;
  }[];
}

/** [Inc 2] One row of `POST /cylinders/bulk-register` (201), for printing labels. */
export interface BulkRegisteredCylinder {
  id: UUID;
  /** The QR value. */
  code: string;
  shortNo: number;
  /** For example "AG-C0036". */
  shortCode: string;
  sizeLabel: string;
}
