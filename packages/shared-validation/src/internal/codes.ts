/**
 * Copies of the shared-types unions these schemas validate against. shared-validation depends only on
 * zod, so the lists are repeated here and NOT exported from the package: the schemas infer the same
 * literal types, and `__tests__/contract-sync.spec.ts` fails if a copy drifts from shared-types.
 */

export const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'FAILED'] as const;
export const TRIP_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'ABORTED'] as const;
export const USER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'DISPATCHER', 'STORE_KEEPER', 'DISTRIBUTOR', 'DRIVER', 'CLIENT'] as const;
export const USER_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED'] as const;
export const PAYMENT_PROVIDERS = ['JAZZCASH', 'EASYPAISA', 'BANK_MANUAL'] as const;

export const ORDER_CANCEL_REASONS = ['CUSTOMER_CANCELLED', 'WRONG_ORDER', 'DUPLICATE', 'OUT_OF_STOCK', 'OTHER'] as const;
export const DELIVERY_FAILURE_REASONS = [
  'CUSTOMER_NOT_HOME',
  'CUSTOMER_REFUSED',
  'WRONG_ADDRESS',
  'NOT_REACHABLE',
  'VAN_PROBLEM',
  'OTHER',
] as const;
export const TOPUP_REJECT_REASONS = ['NOT_IN_BANK', 'AMOUNT_DIFFERENT', 'NAME_DIFFERENT', 'DUPLICATE', 'OTHER'] as const;
export const CORRECTION_REASONS = ['WRONG_TOPUP_APPROVAL', 'SYSTEM_ERROR', 'BANK_REVERSAL', 'OPENING_BALANCE', 'OTHER'] as const;
export const CORRECTION_DIRECTIONS = ['ADD', 'TAKE'] as const;
export const PAYER_CHANNELS = ['EASYPAISA_APP', 'BANK_APP', 'OTHER'] as const;
export const STORED_FILE_PURPOSES = ['TOPUP_PROOF', 'EXPENSE_RECEIPT', 'DAY_END_SHEET', 'DAY_END_UPLOAD', 'OTHER'] as const;
export const STATEMENT_KINDS = [
  'TOPUP_ADDED',
  'DELIVERY_COST',
  'DELIVERY_COST_RETURNED',
  'OPENING_BALANCE',
  'CORRECTION',
  'LEGACY',
  'REFILL_DELIVERY_COST',
] as const;

export const ORDER_LIST_TABS = ['active', 'done'] as const;
export const ORDER_BOARD_TABS = ['needs-driver', 'in-progress', 'done-today', 'cancelled-failed', 'all'] as const;
export const ADMIN_TOPUP_TABS = ['to-check', 'approved', 'rejected', 'all'] as const;

/** [Inc 2] Why a visit took back fewer cylinders than expected (shared-types `TAKE_BACK_SHORT_REASONS`). */
export const TAKE_BACK_SHORT_REASONS = ['CUSTOMER_KEPT', 'CUSTOMER_HAD_NONE', 'OTHER'] as const;
/** [Inc 2] The state a driver taps for a taken-back cylinder (shared-types `ReturnState`). */
export const RETURN_STATES = ['EMPTY', 'PART_FILLED', 'FULL'] as const;
/** [Inc 2] How a confirmation link is passed on (shared-types `CONFIRMATION_SHARE_VIAS`). */
export const CONFIRMATION_SHARE_VIAS = ['WHATSAPP', 'SMS', 'SHARE_SHEET', 'COPY'] as const;
/** [Inc 2] The customer's four answers (shared-types `CONFIRMATION_RESPONSES`). */
export const CONFIRMATION_RESPONSES = ['YES', 'PARTLY', 'NO', 'OTHER'] as const;
/** [Inc 2] A case is OPEN until the office resolves it (shared-types `CASE_STATUSES`). */
export const CASE_STATUSES = ['OPEN', 'RESOLVED'] as const;
/** [Inc 2] How a cylinder number reached the server (shared-types `SCAN_ENTRY_METHODS`). */
export const SCAN_ENTRY_METHODS = ['QR', 'TYPED'] as const;
/** [Inc 2] The actions a driver scans at a stop (shared-types `DRIVER_SCAN_ACTIONS`). */
export const DRIVER_SCAN_ACTIONS = ['LOAD', 'HANDOVER', 'TAKE_BACK'] as const;

/** The four driver moves the legacy `POST /custody/scan` still accepts (API_CONTRACT §7.7). */
export const LEGACY_SCAN_EVENT_TYPES = ['SCAN_OUT', 'DELIVERED', 'PICKED_UP_EMPTY', 'SCAN_IN'] as const;

/** Prisma `DriverAvailability` (shared-types `DriverAvailability`). */
export const DRIVER_AVAILABILITIES = ['AVAILABLE', 'ON_LEAVE', 'OFF_DUTY'] as const;
/** Prisma `VehicleStatus` (shared-types `VehicleStatus`). */
export const VEHICLE_STATUSES = ['ACTIVE', 'MAINTENANCE', 'RETIRED'] as const;
/** Prisma `AlertStatus` (shared-types `AlertStatus`). */
export const ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;
/** Prisma `AlertSeverity` (shared-types `AlertSeverity`). */
export const ALERT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
/** Prisma `AlertRuleKind` (shared-types `AlertRuleKind`). */
export const ALERT_RULE_KINDS = ['DISTRIBUTOR_BALANCE_LOW', 'DISTRIBUTOR_CREDIT_OVER', 'STORE_STOCK_LOW', 'SPECIAL_CLIENT'] as const;
/** Prisma `TicketStatus` (shared-types `TicketStatus`). */
export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
