/**
 * `status`: the plain words for every enum value a screen may show (`status:<kind>.<VALUE>`), read by
 * `<StatusChip kind value />`. Owned by the foundation lane; tones and icons live in `ui/statusTones.ts`.
 * Never show the raw value: an unknown value renders "Unknown" (UX_ADMIN §1.5). Chips have 1–3 words
 * (UX_PRINCIPLES §4.2); buttons keep their verbs ("Could not deliver…").
 */
export const status = {
  /** `OrderStage` (API_CONTRACT §1.4, UX_ADMIN §2.5). */
  order: {
    NEEDS_DRIVER: 'Needs a driver',
    DRIVER_ASSIGNED: 'Driver assigned',
    LOADING: 'Loading',
    ON_THE_WAY: 'On the way',
    DELIVERED: 'Delivered',
    NOT_DELIVERED: 'Not delivered',
    CANCELLED: 'Cancelled',
  },
  /** Raw `OrderStatus`, for screens that still read it (prefer `order` with the stage). */
  orderStatus: {
    PENDING: 'Needs a driver',
    CONFIRMED: 'Needs a driver',
    ASSIGNED: 'Driver assigned',
    IN_TRANSIT: 'On the way',
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled',
    FAILED: 'Not delivered',
  },
  /** `OrderFeeStatus`, shown by `<FeeChip />`. Never "on hold" (ADR-06). */
  fee: {
    DEDUCTED: '{{amount}} paid',
    REVERSED: '{{amount}} returned',
    NONE: 'No delivery cost',
  },
  /** `PaymentDto.stage`, as the office says it (UX_ADMIN §2.2). */
  topup: {
    BEING_CHECKED: 'To check',
    ADDED: 'Approved',
    NOT_ADDED: 'Rejected',
  },
  /** Raw `PaymentStatus`, for older screens. */
  payment: {
    PENDING: 'To check',
    SUCCESS: 'Approved',
    REJECTED: 'Rejected',
    FAILED: 'Not added',
    REFUNDED: 'Refunded',
  },
  /** `DistributorStatus` (UX_ADMIN §2.4). */
  distributor: {
    PENDING: 'Waiting to start',
    ACTIVE: 'Active',
    SUSPENDED: 'Suspended',
  },
  /** `UserStatus`. */
  user: {
    PENDING: 'Not active yet',
    ACTIVE: 'Active',
    SUSPENDED: 'Suspended',
  },
  /** `PriceStatus` (UX_ADMIN §2.3). */
  price: {
    SET: 'Set',
    NOT_SET: 'Not set',
    OUTSIDE: 'Outside every zone',
  },
  /** An expense row (UX_ADMIN §2.7). */
  expense: {
    ACTIVE: 'Recorded',
    VOIDED: 'Removed',
  },
  /** An expense type (UX_ADMIN §2.7). */
  expenseType: {
    ACTIVE: 'In use',
    ARCHIVED: 'Archived',
  },
  /**
   * `RefillStage` (API_CONTRACT §1.4), sent as `stage` on every refill from Inc 1: the UX_ADMIN §4.1
   * words without their counts, for chips that show no progress (the legacy refill screen).
   */
  refillStage: {
    NEEDS_DRIVER: 'Needs a driver',
    DRIVER_ASSIGNED: 'Driver assigned',
    PICKING_UP: 'Picking up empties',
    PICKED_UP: 'Empties picked up',
    AT_STATION: 'At the station',
    COMING_BACK: 'Coming back',
    BACK_AT_STORE: 'Back at store',
    DONE: 'Done',
    CANCELLED: 'Cancelled',
  },
  /** `FillingOrderStatus` (legacy refill screen, Inc 1). */
  refill: {
    PENDING: 'Needs a driver',
    ASSIGNED: 'Driver assigned',
    EMPTIES_PICKED: 'Empties picked up',
    AT_STATION: 'At the station',
    FILLED: 'Filled',
    RETURNED: 'Back at store',
    COMPLETED: 'Done',
    CANCELLED: 'Cancelled',
    FAILED: 'Failed',
  },
  /** `TripStatus`. */
  trip: {
    PLANNED: 'Not started',
    IN_PROGRESS: 'On the road',
    COMPLETED: 'Done',
    ABORTED: 'Stopped',
  },
  /** `TripStopStatus`. */
  stop: {
    PENDING: 'To do',
    ARRIVED: 'Arrived',
    DONE: 'Done',
    FAILED: 'Not delivered',
    CANCELLED: 'Cancelled',
  },
  /** `VehicleStatus`. */
  vehicle: {
    ACTIVE: 'In service',
    MAINTENANCE: 'In the workshop',
    RETIRED: 'Retired',
  },
  /** `DriverAvailability`. */
  driver: {
    AVAILABLE: 'Available',
    ON_LEAVE: 'On leave',
    OFF_DUTY: 'Off duty',
  },
  /** A driver's app connection (`isOnline`). */
  presence: {
    ONLINE: 'On duty',
    OFFLINE: 'Offline',
  },
  /** `CylinderState`. */
  cylinder: {
    FULL: 'Full',
    EMPTY: 'Empty',
    FAULTY: 'Faulty',
    LOST: 'Lost',
  },
  /** `AlertStatus`. */
  alert: {
    OPEN: 'Open',
    ACKNOWLEDGED: 'Seen',
    RESOLVED: 'Sorted',
  },
  /** `AlertSeverity`. */
  severity: {
    INFO: 'Info',
    WARNING: 'Warning',
    CRITICAL: 'Urgent',
  },
  /** `TransferStatus` (switched off for the pilot). */
  transfer: {
    REQUESTED: 'Requested',
    IN_TRANSIT: 'On the way',
    COMPLETED: 'Done',
    CANCELLED: 'Cancelled',
  },
  /** A settings module (UX_ADMIN §2.8). */
  module: {
    ON: 'On',
    OFF: 'Off',
  },
} as const;
