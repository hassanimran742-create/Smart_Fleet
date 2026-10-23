import type { GeoPoint, IsoDateTime, ISODateString, UUID } from './common.types';
import type { OrderStatusValue } from './order.types';

export enum TripStatus {
  PLANNED = 'PLANNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  ABORTED = 'ABORTED',
}

/** The wire value of a {@link TripStatus}. A string union, so Prisma's enum values are assignable to it. */
export type TripStatusValue = `${TripStatus}`;

export enum TripStopType {
  STORE_PICKUP = 'STORE_PICKUP',
  DELIVERY = 'DELIVERY',
  RETURN_DROPOFF = 'RETURN_DROPOFF',
}

/** The wire value of a {@link TripStopType}. */
export type TripStopTypeValue = `${TripStopType}`;

/**
 * Mirrors Prisma `TripStopStatus` (inc1a). PENDING → ARRIVED → DONE; an open stop becomes CANCELLED
 * (its order was cancelled or reassigned) or FAILED (its order could not be delivered). Apps show
 * FAILED and CANCELLED as "Skipped".
 */
export const TripStopStatus = {
  PENDING: 'PENDING',
  ARRIVED: 'ARRIVED',
  DONE: 'DONE',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type TripStopStatus = (typeof TripStopStatus)[keyof typeof TripStopStatus];

/**
 * [Inc 2] Why a visit finished with fewer cylinders taken back than expected (API_CONTRACT §1.5,
 * `TAKE_BACK_SHORT`). `OTHER` needs a note.
 */
export const TAKE_BACK_SHORT_REASONS = ['CUSTOMER_KEPT', 'CUSTOMER_HAD_NONE', 'OTHER'] as const;
export type TakeBackShortReason = (typeof TAKE_BACK_SHORT_REASONS)[number];

export interface TripStop {
  id: UUID;
  tripId: UUID;
  orderId?: UUID;
  seq: number;
  stopType: TripStopType;
  location: GeoPoint;
  etaAt?: ISODateString;
  arrivedAt?: ISODateString;
  departedAt?: ISODateString;
  notes?: string;
}

export interface Trip {
  id: UUID;
  driverId: UUID;
  vehicleId: UUID;
  originStoreId: UUID;
  status: TripStatus;
  stops: TripStop[];
  plannedAt: ISODateString;
  startedAt?: ISODateString;
  completedAt?: ISODateString;
}

/** Buttons a trip offers its caller (API_CONTRACT §1.6, §7.7). */
export type TripAction = 'START' | 'COMPLETE' | 'ABORT';

/** Buttons a stop offers the trip's driver (API_CONTRACT §1.6, §7.7). */
export type TripStopAction = 'ARRIVE' | 'DEPART';

/**
 * One stop of `GET /trips/mine` and `GET /trips/:id` (API_CONTRACT §7.7: the existing shape plus
 * `status` and `allowedActions`). `location` is the pin as `{ lat, lng }`; the server also sends the
 * legacy `coordinates` array for installed apps, which new code doesn't read.
 */
export interface TripStopDto {
  id: UUID;
  tripId: UUID;
  orderId: UUID | null;
  storeId: UUID | null;
  seq: number;
  stopType: TripStopTypeValue;
  status: TripStopStatus;
  location: GeoPoint | null;
  etaAt: IsoDateTime | null;
  arrivedAt: IsoDateTime | null;
  departedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  cancelledAt: IsoDateTime | null;
  notes: string | null;
  /** What the trip's driver may press now; `[]` for anyone else. */
  allowedActions: TripStopAction[];
}

/** A line of an order on a trip: what to load and what to take back. */
export interface TripOrderLineDto {
  id: UUID;
  cylinderTypeId: UUID;
  fullCount: number;
  expectedReturnCount: number;
  cylinderType: { id: UUID; code: string; name: string; /** A decimal on the wire ("11.80"). */ weightKg: string } | null;
}

/** An order on a trip, with the fields the driver screens read. */
export interface TripOrderDto {
  id: UUID;
  status: OrderStatusValue;
  deliveryAddressLabel: string | null;
  loadStartedAt: IsoDateTime | null;
  client: { id: UUID; name: string; phone: string; address: string | null; area: string | null } | null;
  distributor: { id: UUID; businessName: string; code: string | null } | null;
  lines: TripOrderLineDto[];
}

/**
 * A trip as `GET /trips/mine` (a bare array, newest first) and `GET /trips/:id` send it (API_CONTRACT
 * §7.7). `driver` and `allowedActions` come with `GET /trips/:id` and the step answers.
 */
export interface TripViewDto {
  id: UUID;
  driverId: UUID;
  vehicleId: UUID;
  originStoreId: UUID;
  status: TripStatusValue;
  plannedAt: IsoDateTime;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  stops: TripStopDto[];
  orders: TripOrderDto[];
  originStore: { id: UUID; name: string; address: string } | null;
  vehicle: { id: UUID; plateNo: string } | null;
  driver?: { id: UUID; name: string; phone: string };
  allowedActions?: TripAction[];
}

/** [Inc 2] One size on a stop: how many the orders need and how many are done (API_CONTRACT §9.3). */
export interface StopProgressLine {
  cylinderTypeId: UUID;
  sizeLabel: string;
  needed: number;
  done: number;
}

/** [Inc 2] A return state the driver taps (API_CONTRACT §9.3, TAKE_BACK `returnState`). */
export type ReturnState = 'EMPTY' | 'PART_FILLED' | 'FULL';

/**
 * [Inc 2] How far a stop has got (API_CONTRACT §9.3). Sent on every scan answer and, as
 * `details.progress`, on every scan refusal, so the screen still shows "3 of 5" after one.
 */
export type StopProgress =
  | {
      type: 'STORE_PICKUP';
      lines: StopProgressLine[];
      doneCount: number;
      neededCount: number;
      complete: boolean;
    }
  | {
      type: 'DELIVERY';
      give: { lines: StopProgressLine[]; doneCount: number; neededCount: number; complete: boolean };
      takeBack: {
        expected: number;
        /** `items.length` + Σ `unlabelled.count`. */
        count: number;
        byState: Record<ReturnState, number>;
        items: { code: string; shortNo: number | null; sizeLabel: string; state: ReturnState }[];
        unlabelled: { cylinderTypeId: UUID; sizeLabel: string; state: ReturnState; count: number }[];
      };
      canFinish: boolean;
      blockers: { code: string; details: Record<string, unknown> }[];
    };
