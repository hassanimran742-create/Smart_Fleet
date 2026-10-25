import type { GeoPoint, IsoDate, IsoDateTime, ISODateString, UUID } from './common.types';
import type { VanLeftoverCylinder } from './errors';
import type { OrderDto, OrderStatusValue } from './order.types';

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

/**
 * [Inc 2] A stop of `GET /trips/:tripId` from Inc 2 (API_CONTRACT §9.3: `stops[]: { id, seq, type,
 * status, title, address, location, progress }`): the Inc 1 stop plus its step words and progress.
 */
export interface TripStopViewDto extends TripStopDto {
  /** The same as `stopType`, as API_CONTRACT §9.3 names it. */
  type: TripStopTypeValue;
  /** What the step is about: the store's name, or the customer's name. */
  title: string;
  /** The store's address, or the delivery address label. */
  address: string | null;
  /** How far the stop has got; null for a RETURN_DROPOFF stop. */
  progress: StopProgress | null;
}

/**
 * [Inc 2] `GET /trips/:tripId` from Inc 2: the Inc 1 {@link TripViewDto} plus each stop's progress, what
 * is on the van (the Unload step's "{{count}} on the van") and the trip's buttons.
 */
export interface TripDetailDto extends Omit<TripViewDto, 'stops' | 'allowedActions'> {
  stops: TripStopViewDto[];
  van: TripVanDto | null;
  /** Set by a finish with cylinders left on the van while `trip.allowFinishWithLeftovers` is on. */
  leftoverReason: string | null;
  allowedActions: TripAction[];
}

/**
 * [Inc 2] The cylinders on a van by state (UX_MOBILE §7.2: "3 full · 1 empty · 1 part-filled").
 * `total` counts every cylinder on the van, damaged or lost ones included.
 */
export interface VanCounts {
  full: number;
  empty: number;
  partFilled: number;
  total: number;
}

/**
 * [Inc 2] The van of `GET /trips/:tripId`: its counts, plus every cylinder on it from the trip's point of
 * view (the list `TRIP_VAN_NOT_EMPTY` names: `came` TAKEN_BACK, NOT_DELIVERED or SPARE). Cylinders on an
 * open refill line aren't the trip's, so they are left out of `cylinders` (they still count in the
 * counts). The driver's Unload rows tick off as the store scans them in (UX_MOBILE §7.2 R7).
 */
export type TripVanDto = VanCounts & { cylinders: VanLeftoverCylinder[] };

/**
 * [Inc 2] A trip row of `GET /driver/home` (UX_MOBILE §7.2 R2: "Trip · {{count}} customers · load at
 * {{store}}", a step chip, "Start" or "Continue").
 */
export interface TripSummary {
  id: UUID;
  status: TripStatusValue;
  plannedAt: IsoDateTime;
  startedAt: IsoDateTime | null;
  /** The distributor's store, where the trip loads. */
  store: { id: UUID; name: string };
  /** DELIVERY stops that are not CANCELLED. */
  customers: number;
  /** The customers' names in visit order (the DELIVERY stops that are not CANCELLED): "Deliver to Sana". */
  customerNames: string[];
  /** Full cylinders the trip's orders deliver (orders not CANCELLED or FAILED): "3 cylinders". */
  cylinders: number;
  /** Stops DONE, FAILED or CANCELLED, of all stops. */
  stops: { done: number; total: number };
}

/** [Inc 2] `GET /driver/home` (DRIVER exact): the Today screen in one request. */
export interface DriverHomeDto {
  /** The current business day (`day.timezone`, `day.cutoffLocalTime`). */
  businessDate: IsoDate;
  /** The duty switch (`drivers.is_online`). */
  onDuty: boolean;
  vehicle: { id: UUID; plateNo: string } | null;
  van: VanCounts;
  activeTrip: TripSummary | null;
  nextTrips: TripSummary[];
  /** Trips COMPLETED in the current business day. */
  doneToday: number;
}

/** [Inc 2] `GET /trips/:tripId/stops/:stopId` (the trip's driver). `order` is null for the STORE_PICKUP stop. */
export interface StopDetailDto {
  stop: TripStopViewDto;
  order: OrderDto | null;
  progress: StopProgress;
}

/**
 * [Inc 2] `POST /trips/:tripId/stops/:stopId/finish`. `order` is null for the STORE_PICKUP stop ("Done
 * loading"); `nextStopId` is the next open stop, null when none is left. The driver never receives the
 * confirmation link.
 */
export interface StopFinishResult {
  order: OrderDto | null;
  nextStopId: UUID | null;
}

/** [Inc 2] `PUT /trips/:tripId/stops/:stopId/unlabelled-returns`. */
export interface UnlabelledReturnsResult {
  progress: StopProgress;
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
