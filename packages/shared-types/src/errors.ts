import type { IdName, IsoDate, IsoDateTime, Paisa, UUID } from './common.types';
import type { DayEndRowErrorCode, DaySheetName } from './day-end.types';
import type { PaymentStatusValue } from './payment.types';
import type { DeliveryQuote, PricingBlockCode } from './pricing.types';
import type { RefillScanProgress } from './refill.types';
import type { StopProgress } from './trip.types';
import type { UserRoleValue } from './user.types';

/**
 * The error catalogue (API_CONTRACT §2.3): every stable code, its HTTP status and its English text.
 * These codes are the whole list. Adding one means adding its status and English text here, plus an
 * `errors.<CODE>` key in both apps.
 *
 * English texts are i18next templates: `{{param}}` comes from the error's `details`, and a details key
 * ending in `Paisa` is formatted with `formatRs` and loses its suffix (`requiredPaisa` becomes
 * `{{required}}`). `renderMessage` in @smartfleet/shared-utils applies that rule.
 */
const CATALOGUE = {
  // General
  VALIDATION_FAILED: [400, 'Some details need fixing.'],
  AMOUNT_NOT_WHOLE_RUPEES: [400, 'Enter whole rupees, with no paisa.'],
  NOT_FOUND: [404, "We couldn't find this. It may have been removed."],
  PERMISSION_DENIED: [403, "Your account can't do this."],
  FEATURE_DISABLED: [403, "This isn't available yet."],
  RATE_LIMITED: [429, 'Too many tries. Please wait {{minutes}} min and try again.'],
  APP_UPDATE_REQUIRED: [426, 'Please update the app to continue.'],
  CONFLICT_STALE_STATE: [409, 'This changed while you were looking. Refresh and try again.'],
  CONFLICT_DUPLICATE: [409, 'This already exists.'],
  IDEMPOTENCY_CONFLICT: [409, 'This was already sent with different details. Start again.'],
  INTERNAL_ERROR: [500, 'Something went wrong on our side. Please try again.'],
  SERVICE_UNAVAILABLE: [503, 'The service is busy. Please try again in a minute.'],
  // Auth and users
  AUTH_INVALID_CREDENTIALS: [401, 'Wrong phone number or password.'],
  AUTH_ACCOUNT_NOT_ACTIVE: [403, "This account isn't active. Call the office."],
  AUTH_ROLE_LOCKED: [403, "This account can't sign in. Call the office."],
  AUTH_WRONG_APP: [403, 'This account is for the {{app}}.'],
  AUTH_OTP_DISABLED: [403, 'Sign in with your password.'],
  AUTH_SESSION_REVOKED: [401, 'Please sign in again.'],
  AUTH_TOKEN_INVALID: [401, 'Please sign in again.'],
  AUTH_REFRESH_INVALID: [401, 'Please sign in again.'],
  USER_PHONE_IN_USE: [409, 'This phone number is already used by another account.'],
  USER_CNIC_IN_USE: [409, 'This CNIC is already registered.'],
  USER_FIELD_OFFICE_ONLY: [403, 'Ask the office to change this.'],
  USER_ROLE_CHANGE_NOT_ALLOWED: [403, "This role change isn't allowed."],
  USER_SELF_CHANGE_NOT_ALLOWED: [403, "You can't change your own account this way."],
  USER_LAST_SUPER_ADMIN: [409, 'At least one active super admin must remain.'],
  // Distributors, stores, zones, customers
  DISTRIBUTOR_NOT_ACTIVE: [403, "This shop account isn't active. Call the office."],
  DISTRIBUTOR_NO_STORE: [409, 'This shop has no store set up yet. Call the office.'],
  DISTRIBUTOR_CODE_IN_USE: [409, 'Another shop already uses the code {{code}}.'],
  DISTRIBUTOR_CODE_INVALID: [400, 'Use 2 to 6 capital letters or digits, starting with a letter.'],
  DISTRIBUTOR_CODE_LOCKED: [409, "The shop code can't change after the first order."],
  STORE_OUTSIDE_ZONES: [422, 'This spot is outside every active zone. Move the pin.'],
  STORE_IN_USE: [409, "This store belongs to a shop and can't be removed."],
  ZONE_INVALID_SHAPE: [400, "This zone shape isn't valid."],
  ZONE_ARCHIVED: [409, 'This zone is archived.'],
  CLIENT_NOT_FOUND: [404, "We couldn't find this customer."],
  CLIENT_ADDRESS_NOT_FOUND: [404, "We couldn't find this address."],
  CLIENT_PHONE_INVALID: [400, 'Enter a number like 300 1234567.'],
  CLIENT_PHONE_EXISTS: [409, '{{name}} already has this number. Pick them from the list.'],
  // Pricing
  PRICING_ZONE_NOT_COVERED: [422, 'This location is outside our delivery area.'],
  PRICING_PRICE_NOT_SET: [422, 'No delivery price is set for {{zoneName}} yet. Ask the office to set it.'],
  PRICING_QUOTE_CHANGED: [409, 'The delivery cost is now {{total}}. Check it and place the order again.'],
  PRICE_INVALID: [400, 'Enter whole rupees, from Rs 0 to Rs 100,000.'],
  // Orders, trips, assignment
  ORDER_LINES_INVALID: [400, 'Add at least one full cylinder, one line per size.'],
  ORDER_TOO_MANY_CYLINDERS: [400, 'Too many cylinders. An order can have at most {{max}}.'],
  ORDER_INVALID_TRANSITION: [409, "This order can't move to that step now. Refresh and try again."],
  ORDER_NOT_CANCELLABLE: [409, 'This order is already finished.'],
  ORDER_HANDOVER_STARTED: [409, 'Cylinders were already handed over. Call the office.'],
  ORDER_CANCEL_TERMS_CHANGED: [409, 'Delivery has just started. The refund is now {{refund}}.'],
  ORDER_NOT_STARTED_USE_CANCEL: [409, "Delivery hasn't started. Cancel the order instead."],
  ORDER_NOT_ON_YOUR_TRIP: [403, "This order isn't on your trip."],
  ORDER_USE_MANUAL_DELIVERY: [400, 'Use "Mark delivered by office" for this.'],
  ORDER_NOT_ASSIGNABLE: [409, "This order can't get a driver now."],
  ASSIGN_DRIVER_NOT_AVAILABLE: [409, "{{driver}} can't take jobs right now."],
  ASSIGN_DRIVER_NO_VEHICLE: [409, '{{driver}} has no van. Give them a van first.'],
  ASSIGN_ORDER_LOADED: [409, "Cylinders are already loaded on {{plateNo}}, so this order can't change driver."],
  DISPATCH_AUTO_OFF: [403, 'Automatic assignment is switched off.'],
  TRIP_INVALID_TRANSITION: [409, "This trip can't move to that step now."],
  TRIP_ORDERS_OPEN: [409, 'Finish or close every order on this trip first.'],
  DELIVERY_SCANS_INCOMPLETE: [409, 'Scan every cylinder before you finish the visit.'], // Inc 2
  TAKE_BACK_SHORT: [409, 'The customer gave back {{taken}} of {{expected}}. Say why to finish.'], // Inc 2
  MANUAL_DELIVERY_CYLINDERS_MISMATCH: [409, "The cylinders don't match the order."], // Inc 2
  TRIP_STOPS_OPEN: [409, 'Finish every stop first.'], // Inc 2
  TRIP_VAN_NOT_EMPTY: [409, 'The store must scan in {{count}} more from your van.'], // Inc 2
  LOAD_INCOMPLETE: [409, 'Load every cylinder first: {{done}} of {{total}} loaded so far.'], // Inc 2
  VEHICLE_HAS_CYLINDERS: [409, 'This van still has cylinders on it ({{count}}). Unload at the store first.'], // Inc 2
  // Scans
  SCAN_CYLINDER_UNKNOWN: [404, "We don't know this cylinder. Check the label."],
  SCAN_EVENT_NOT_ALLOWED: [403, "This scan isn't allowed."],
  SCAN_USE_STORE_RECEIVE: [403, 'Ask the store to scan it in.'], // Inc 2
  SCAN_TRIP_CLOSED: [409, 'This trip is closed.'],
  SCAN_STOP_CLOSED: [409, 'This step is already done.'], // Inc 2
  SCAN_NOT_AT_STORE: [409, "This cylinder isn't in {{store}}'s stock. Load only from this store."],
  SCAN_WRONG_OWNER: [409, 'This cylinder belongs to another shop.'],
  SCAN_NOT_FULL: [409, "This cylinder isn't full. Load only full cylinders."],
  SCAN_CYLINDER_BLOCKED: [409, 'Marked damaged or lost. Put it aside. Call office.'],
  SCAN_NOT_ON_YOUR_VAN: [409, "Not loaded on your van. Don't deliver it. Call office."],
  SCAN_TAKEN_BACK_NOT_UNLOADED: [409, 'Taken back from a customer. Unload it at the store first.'], // Inc 2
  SCAN_SIZE_NOT_IN_ORDER: [409, "This is {{sizeLabel}}. This order doesn't need it."], // Inc 2
  SCAN_COUNT_REACHED: [409, 'You already have all {{needed}} × {{sizeLabel}}.'], // Inc 2
  SCAN_LOAD_NOT_NEEDED: [409, "This size isn't needed on this trip any more."], // Inc 2
  SCAN_NOT_WITH_THIS_CUSTOMER: [409, "Our records don't show this cylinder with this customer."],
  SCAN_GIVEN_THIS_VISIT: [409, "You just delivered this one. You can't take it back now."],
  SCAN_RETURN_STATE_REQUIRED: [400, 'Choose Empty, Part-filled or Full first.'], // Inc 2
  SCAN_NOT_ON_A_VAN: [409, "This cylinder isn't on a van."], // Inc 2
  SCAN_ID_REUSED: [409, 'This scan was already used for something else. Scan again.'], // Inc 2
  // Customer confirmation and cases [Inc 2]
  CONFIRM_LINK_INVALID: [404, "This link isn't valid."],
  CONFIRM_LINK_EXPIRED: [410, 'This link has expired.'],
  CONFIRM_LINK_INACTIVE: [410, 'This link is no longer active.'],
  CONFIRM_ALREADY_ANSWERED: [409, 'This delivery was already answered.'],
  CONFIRM_NOTE_REQUIRED: [400, 'Please write a few words.'],
  CONFIRM_NOT_READY: [409, "This order isn't delivered yet."],
  CONFIRM_CLOSED: [409, 'The customer can no longer answer for this order.'],
  CASE_ALREADY_RESOLVED: [409, 'This problem was already sorted by {{by}}.'],
  // Top-ups and wallet
  TOPUP_AMOUNT_TOO_SMALL: [400, 'The minimum top-up is {{min}}.'],
  TOPUP_AMOUNT_TOO_LARGE: [400, 'The maximum top-up is {{max}}.'],
  TOPUP_WOULD_EXCEED_CAP: [409, "Your balance can't go above {{cap}}. You can add up to {{maxNow}} now."],
  TOPUP_TOO_MANY_PENDING: [409, 'Top-ups being checked: {{count}}. Wait for them before sending another.'],
  TOPUP_NOT_PENDING: [409, 'This request was already handled.'],
  TOPUP_BANK_REFERENCE_REQUIRED: [400, 'Type the bank reference from the company bank app.'],
  TOPUP_BANK_REFERENCE_USED: [409, 'Already used for {{paymentShortCode}} ({{distributorName}}). Check it, or reject as a duplicate.'],
  TOPUP_BANK_TIME_IN_FUTURE: [400, "The bank time can't be in the future."],
  TOPUP_AMOUNT_MISMATCH: [409, 'Amounts must match. Reject and ask for a new request.'],
  TOPUP_ACCOUNT_NOT_CONFIGURED: [503, "Top-ups aren't open yet. Call the office."],
  PAYMENT_WEBHOOK_DISABLED: [410, 'Online payments are switched off.'],
  WALLET_INSUFFICIENT_BALANCE: [409, 'Not enough balance. This needs {{required}} and you have {{balance}}. Add money to continue.'],
  WALLET_ADJUST_EXCEEDS_BALANCE: [409, "The balance is only {{balance}}. You can't take more than that."],
  // Files
  FILE_TYPE_NOT_ALLOWED: [415, 'Use a JPG, PNG or WebP picture.'],
  FILE_TOO_LARGE: [413, 'This file is too big. The limit is {{maxMb}} MB.'],
  FILE_NOT_FOUND: [404, "We couldn't find this file. Upload it again."],
  // Expenses
  EXPENSE_TYPE_NAME_TAKEN: [409, "There's already a type called {{name}}."],
  EXPENSE_TYPE_ARCHIVED: [409, '{{name}} is archived. Pick another type or restore it.'],
  EXPENSE_TYPE_LOCKED: [409, "{{name}} can't be archived."],
  EXPENSE_DATE_IN_FUTURE: [400, "The date can't be in the future."],
  EXPENSE_ALREADY_VOIDED: [409, 'This expense was already removed.'],
  // Refills
  REFILL_DIY_RETIRED: [410, 'Do-it-yourself refills are no longer used. Request a refill instead.'],
  REFILL_TOO_MANY: [400, 'Too many cylinders. A refill can have at most {{max}}.'],
  REFILL_NOT_CANCELLABLE: [409, "This refill can't be cancelled after pickup."],
  REFILL_INVALID_COUNT: [400, 'Check the number of cylinders.'],
  REFILL_STATION_INACTIVE: [409, "This station isn't taking refills."],
  REFILL_WRONG_STEP: [409, "This refill isn't at that step."],
  REFILL_CYLINDER_WRONG_SIZE: [409, 'This refill is for {{sizeLabel}} only.'], // Inc 3
  REFILL_CYLINDER_NOT_EMPTY: [409, 'Only empty or part-filled cylinders go for refill.'], // Inc 3
  REFILL_CYLINDER_ON_OTHER_REFILL: [409, 'This cylinder is already on another refill.'], // Inc 3
  REFILL_COUNT_REACHED: [409, 'All picked up: {{requested}} of {{requested}}.'], // Inc 3
  REFILL_CYLINDER_NOT_ON_THIS_REFILL: [409, "This cylinder wasn't picked up for this refill."], // Inc 3
  REFILL_USE_SCANS: [410, 'Update the app to continue.'], // Inc 3
  REFILL_AUTO_COMPLETES: [410, 'Refills now finish by themselves when the store scans them in.'], // Inc 3
  // Day-end [Inc 3]
  DAY_NOT_FOUND: [404, "We couldn't find this day."],
  DAY_LOCKED: [409, 'This day is closed. Ask the office to reopen it.'],
  DAY_SHEET_UNREADABLE: [422, "This file isn't the day-end sheet. Download today's sheet and try again."],
  DAY_SHEET_WRONG_DISTRIBUTOR: [422, 'This sheet belongs to another shop.'],
  DAY_SHEET_WRONG_DATE: [422, 'This sheet is for {{sheetDate}}. Upload the sheet for {{date}}.'],
  DAY_SHEET_OUTDATED: [422, 'This is an old copy. Download a new sheet and use that.'],
  DAY_SHEET_ROW_ERRORS: [422, "Some rows couldn't be read. Fix them and upload again."],
  DAY_ALREADY_SUBMITTED: [409, 'This day was already sent for approval.'],
  DAY_NOT_SUBMITTED: [409, "This day hasn't been sent for approval."],
  DAY_SHEET_NOT_UPLOADED: [409, 'Upload the filled sheet first.'],
  DAY_VERSION_CHANGED: [409, 'A newer sheet was uploaded. Load the new version.'],
  // Settings and legacy
  SETTING_UNKNOWN: [404, 'Unknown setting.'],
  SETTING_INVALID_VALUE: [400, "This value isn't allowed here."],
  SETTING_NOT_EDITABLE: [403, "This setting can't be changed here."],
  RECONCILIATION_RETIRED: [410, 'The day-end sheet replaces this form.'], // Inc 3
} as const satisfies Record<string, readonly [number, string]>;

/** A stable, UPPER_SNAKE error code sent by the API as `code` (and repeated as `error`). */
export type ErrorCode = keyof typeof CATALOGUE;

/** Every {@link ErrorCode}, in catalogue order. */
export const ERROR_CODES: readonly ErrorCode[] = Object.keys(CATALOGUE) as ErrorCode[];

function mapCatalogue<T>(pick: (entry: readonly [number, string]) => T): Record<ErrorCode, T> {
  const out = {} as Record<ErrorCode, T>;
  for (const code of ERROR_CODES) out[code] = pick(CATALOGUE[code]);
  return out;
}

/** The HTTP status of each error code. */
export const ERROR_HTTP: { readonly [C in ErrorCode]: (typeof CATALOGUE)[C][0] } = mapCatalogue(
  ([status]) => status,
) as { readonly [C in ErrorCode]: (typeof CATALOGUE)[C][0] };

/** The English text of each error code: the apps' English `errors` resource and the server's `message`. */
export const ERROR_MESSAGE_EN: { readonly [C in ErrorCode]: (typeof CATALOGUE)[C][1] } = mapCatalogue(
  ([, message]) => message,
) as { readonly [C in ErrorCode]: (typeof CATALOGUE)[C][1] };

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CATALOGUE, value);
}

/** Codes the apps make up themselves when there is no server answer (API_CONTRACT §2.3). */
export const CLIENT_ERROR_CODES = ['NETWORK_OFFLINE', 'NETWORK_TIMEOUT', 'UNKNOWN'] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

export const CLIENT_ERROR_MESSAGE_EN: { readonly [C in ClientErrorCode]: string } = {
  NETWORK_OFFLINE: 'No connection. Try again.',
  NETWORK_TIMEOUT: 'This is taking too long. Check your signal and try again.',
  UNKNOWN: 'Something went wrong. Please try again.',
};

/** Any code an app may show: a server code or a client-only one. */
export type AppErrorCode = ErrorCode | ClientErrorCode;

/** The apps' complete English `errors` resource: the server catalogue plus the client-only codes. */
export const APP_ERROR_MESSAGE_EN: { readonly [C in AppErrorCode]: string } = {
  ...ERROR_MESSAGE_EN,
  ...CLIENT_ERROR_MESSAGE_EN,
};

/** One field problem inside a `VALIDATION_FAILED` error (API_CONTRACT §2.2). */
export interface FieldError {
  /** Dotted path into the request body, for example "lines.0.fullCount". */
  path: string;
  /** A validation code from @smartfleet/shared-validation (`VALIDATION_CODES`), never a raw zod code. */
  code: string;
  /** Plain English for the code, with its parameters filled in. */
  message: string;
  /** Template parameters for the code; keys ending in `Paisa` are formatted with `formatRs`. */
  params?: Record<string, string | number>;
}

/** A cylinder still on the van when a trip is finished (Inc 2). */
export interface VanLeftoverCylinder {
  shortCode: string;
  sizeLabel: string;
  state: string;
  came: 'TAKEN_BACK' | 'NOT_DELIVERED' | 'SPARE';
}

/**
 * What a scan refusal carries as `details.progress` (API_CONTRACT §9.3, §10.1): the stop's progress for
 * a driver scan, the refill's counts for a refill scan. Store scans carry none.
 */
export type ScanProgress = StopProgress | RefillScanProgress;

/** Why a named cylinder can't be used by the office's manual delivery v2 (API_CONTRACT §9.5). */
export type ManualDeliveryProblemReason =
  | 'WRONG_OWNER'
  | 'NOT_FULL'
  | 'BLOCKED'
  | 'WRONG_SIZE'
  | 'NOT_AVAILABLE'
  | 'NOT_WITH_THIS_CUSTOMER'
  | 'LISTED_TWICE';

/** One unreadable day-end sheet row (API_CONTRACT §10.2): the first rule the row breaks. */
export interface DaySheetRowError {
  sheet: DaySheetName;
  /** The Excel row number; the header is row 1. */
  row: number;
  code: DayEndRowErrorCode;
  /** `DAY_END_ROW_ERROR_EN[code]`. */
  message: string;
}

/** Scan refusals carry the progress (optional: the legacy Inc 1 scan route has no stops). */
export interface ScanRefusalDetails {
  progress?: ScanProgress;
}

/**
 * The documented `details` of each code that carries any (API_CONTRACT §2 to §10). Codes not listed
 * carry only {@link CommonErrorDetails}. Keys ending in `Paisa` hold digit strings.
 */
export interface ErrorDetailsMap {
  VALIDATION_FAILED: { fields: FieldError[] };
  /** `field` names the missing reference, for example "vehicleId" (API_CONTRACT §7.12). */
  NOT_FOUND: { field?: string };
  RATE_LIMITED: { minutes: number };
  /** For example `{ reason: 'NOT_IMPLEMENTED' }` from a service stub. Never a raw error message. */
  INTERNAL_ERROR: { reason?: string };
  /** `app` is a product name from `APP_DISPLAY_NAME`. */
  AUTH_WRONG_APP: { role: UserRoleValue; app: string };
  USER_PHONE_IN_USE: { existingRole?: UserRoleValue };
  DISTRIBUTOR_CODE_IN_USE: { code: string };
  CLIENT_PHONE_EXISTS: { clientId: UUID; name: string };
  PRICING_PRICE_NOT_SET: { zoneId: UUID; zoneName: string };
  PRICING_QUOTE_CHANGED: { totalPaisa: Paisa; quote: DeliveryQuote };
  ORDER_TOO_MANY_CYLINDERS: { max: number };
  ORDER_INVALID_TRANSITION: { from: string; to: string };
  ORDER_CANCEL_TERMS_CHANGED: { refundPaisa: Paisa };
  /** `driver` is the driver's name. */
  ASSIGN_DRIVER_NOT_AVAILABLE: { driver: string };
  /** `driver` is the driver's name. */
  ASSIGN_DRIVER_NO_VEHICLE: { driver: string };
  ASSIGN_ORDER_LOADED: { plateNo: string };
  DELIVERY_SCANS_INCOMPLETE: { missing: { sizeLabel: string; needed: number; given: number }[] };
  TAKE_BACK_SHORT: { expected: number; taken: number };
  /** Every problem with the named cylinders and the counts per size; nothing moves (§9.5). */
  MANUAL_DELIVERY_CYLINDERS_MISMATCH: {
    problems: { code: string; reason: ManualDeliveryProblemReason; holderType?: 'VEHICLE' | 'CLIENT' }[];
    sizes: { cylinderTypeId: UUID; sizeLabel: string; needed: number; named: number }[];
  };
  /** `leftoversAllowed` is setting `trip.allowFinishWithLeftovers` (§9.3). */
  TRIP_VAN_NOT_EMPTY: { count: number; cylinders: VanLeftoverCylinder[]; leftoversAllowed: boolean };
  LOAD_INCOMPLETE: {
    total: number;
    done: number;
    lines: { cylinderTypeId: UUID; sizeLabel: string; needed: number; done: number }[];
  };
  VEHICLE_HAS_CYLINDERS: { count: number };
  /** `code` is the code that wasn't found, from a manual delivery (§9.5). */
  SCAN_CYLINDER_UNKNOWN: { code?: string } & ScanRefusalDetails;
  SCAN_EVENT_NOT_ALLOWED: ScanRefusalDetails;
  SCAN_USE_STORE_RECEIVE: ScanRefusalDetails;
  SCAN_TRIP_CLOSED: ScanRefusalDetails;
  SCAN_STOP_CLOSED: ScanRefusalDetails;
  /** `store` is the store's name. */
  SCAN_NOT_AT_STORE: { store: string } & ScanRefusalDetails;
  SCAN_WRONG_OWNER: ScanRefusalDetails;
  SCAN_NOT_FULL: ScanRefusalDetails;
  SCAN_CYLINDER_BLOCKED: ScanRefusalDetails;
  SCAN_NOT_ON_YOUR_VAN: ScanRefusalDetails;
  SCAN_TAKEN_BACK_NOT_UNLOADED: ScanRefusalDetails;
  SCAN_SIZE_NOT_IN_ORDER: { sizeLabel: string } & ScanRefusalDetails;
  SCAN_COUNT_REACHED: { needed: number; sizeLabel: string } & ScanRefusalDetails;
  SCAN_LOAD_NOT_NEEDED: ScanRefusalDetails;
  SCAN_NOT_WITH_THIS_CUSTOMER: ScanRefusalDetails;
  SCAN_GIVEN_THIS_VISIT: ScanRefusalDetails;
  SCAN_RETURN_STATE_REQUIRED: ScanRefusalDetails;
  SCAN_NOT_ON_A_VAN: ScanRefusalDetails;
  SCAN_ID_REUSED: ScanRefusalDetails;
  /** `by` is the name of whoever closed it. */
  CASE_ALREADY_RESOLVED: { by: string };
  TOPUP_AMOUNT_TOO_SMALL: { minPaisa: Paisa; maxPaisa: Paisa };
  TOPUP_AMOUNT_TOO_LARGE: { minPaisa: Paisa; maxPaisa: Paisa };
  TOPUP_WOULD_EXCEED_CAP: { capPaisa: Paisa; maxNowPaisa: Paisa };
  TOPUP_TOO_MANY_PENDING: { count: number };
  TOPUP_NOT_PENDING: { status: PaymentStatusValue; reviewedBy: IdName | null; reviewedAt: IsoDateTime | null };
  TOPUP_BANK_REFERENCE_USED: { paymentShortCode: string; distributorName: string; approvedAt: IsoDateTime | null };
  WALLET_INSUFFICIENT_BALANCE: { requiredPaisa: Paisa; balancePaisa: Paisa; shortByPaisa: Paisa };
  WALLET_ADJUST_EXCEEDS_BALANCE: { balancePaisa: Paisa };
  FILE_TOO_LARGE: { maxMb: number };
  EXPENSE_TYPE_NAME_TAKEN: { name: string };
  EXPENSE_TYPE_ARCHIVED: { name: string };
  EXPENSE_TYPE_LOCKED: { name: string };
  REFILL_TOO_MANY: { max: number };
  /** Also raised outside scans (assign, complete, advance), where it carries no progress. */
  REFILL_WRONG_STEP: ScanRefusalDetails;
  REFILL_CYLINDER_WRONG_SIZE: { sizeLabel: string } & ScanRefusalDetails;
  REFILL_CYLINDER_NOT_EMPTY: ScanRefusalDetails;
  REFILL_CYLINDER_ON_OTHER_REFILL: ScanRefusalDetails;
  REFILL_COUNT_REACHED: { requested: number } & ScanRefusalDetails;
  REFILL_CYLINDER_NOT_ON_THIS_REFILL: ScanRefusalDetails;
  /** Both are `YYYY-MM-DD` dates, shown with `formatIsoDay` ("Tue 20 Oct", API_CONTRACT §2.1). */
  DAY_SHEET_WRONG_DATE: { sheetDate: IsoDate; date: IsoDate };
  /** At most 100 rows, in sheet and row order; `total` counts them all (§10.2). */
  DAY_SHEET_ROW_ERRORS: { rows: DaySheetRowError[]; total: number };
}

/**
 * Details any code may add. A repeated action that meets a different final state answers 409 with the
 * specific code and `currentStatus` (API_CONTRACT §4.3). Scan refusals also carry `progress`, listed
 * per code in {@link ErrorDetailsMap}.
 */
export interface CommonErrorDetails {
  currentStatus?: string;
}

/** The `details` object of an error with code `C`. */
export type ErrorDetails<C extends ErrorCode = ErrorCode> = (C extends keyof ErrorDetailsMap
  ? ErrorDetailsMap[C]
  : Record<never, never>) &
  CommonErrorDetails;

const DETAIL_KEYS = {
  VALIDATION_FAILED: ['fields'],
  NOT_FOUND: ['field'],
  RATE_LIMITED: ['minutes'],
  INTERNAL_ERROR: ['reason'],
  AUTH_WRONG_APP: ['role', 'app'],
  USER_PHONE_IN_USE: ['existingRole'],
  DISTRIBUTOR_CODE_IN_USE: ['code'],
  CLIENT_PHONE_EXISTS: ['clientId', 'name'],
  PRICING_PRICE_NOT_SET: ['zoneId', 'zoneName'],
  PRICING_QUOTE_CHANGED: ['totalPaisa', 'quote'],
  ORDER_TOO_MANY_CYLINDERS: ['max'],
  ORDER_INVALID_TRANSITION: ['from', 'to'],
  ORDER_CANCEL_TERMS_CHANGED: ['refundPaisa'],
  ASSIGN_DRIVER_NOT_AVAILABLE: ['driver'],
  ASSIGN_DRIVER_NO_VEHICLE: ['driver'],
  ASSIGN_ORDER_LOADED: ['plateNo'],
  DELIVERY_SCANS_INCOMPLETE: ['missing'],
  TAKE_BACK_SHORT: ['expected', 'taken'],
  MANUAL_DELIVERY_CYLINDERS_MISMATCH: ['problems', 'sizes'],
  TRIP_VAN_NOT_EMPTY: ['count', 'cylinders', 'leftoversAllowed'],
  LOAD_INCOMPLETE: ['total', 'done', 'lines'],
  VEHICLE_HAS_CYLINDERS: ['count'],
  SCAN_CYLINDER_UNKNOWN: ['code', 'progress'],
  SCAN_EVENT_NOT_ALLOWED: ['progress'],
  SCAN_USE_STORE_RECEIVE: ['progress'],
  SCAN_TRIP_CLOSED: ['progress'],
  SCAN_STOP_CLOSED: ['progress'],
  SCAN_NOT_AT_STORE: ['store', 'progress'],
  SCAN_WRONG_OWNER: ['progress'],
  SCAN_NOT_FULL: ['progress'],
  SCAN_CYLINDER_BLOCKED: ['progress'],
  SCAN_NOT_ON_YOUR_VAN: ['progress'],
  SCAN_TAKEN_BACK_NOT_UNLOADED: ['progress'],
  SCAN_SIZE_NOT_IN_ORDER: ['sizeLabel', 'progress'],
  SCAN_COUNT_REACHED: ['needed', 'sizeLabel', 'progress'],
  SCAN_LOAD_NOT_NEEDED: ['progress'],
  SCAN_NOT_WITH_THIS_CUSTOMER: ['progress'],
  SCAN_GIVEN_THIS_VISIT: ['progress'],
  SCAN_RETURN_STATE_REQUIRED: ['progress'],
  SCAN_NOT_ON_A_VAN: ['progress'],
  SCAN_ID_REUSED: ['progress'],
  CASE_ALREADY_RESOLVED: ['by'],
  TOPUP_AMOUNT_TOO_SMALL: ['minPaisa', 'maxPaisa'],
  TOPUP_AMOUNT_TOO_LARGE: ['minPaisa', 'maxPaisa'],
  TOPUP_WOULD_EXCEED_CAP: ['capPaisa', 'maxNowPaisa'],
  TOPUP_TOO_MANY_PENDING: ['count'],
  TOPUP_NOT_PENDING: ['status', 'reviewedBy', 'reviewedAt'],
  TOPUP_BANK_REFERENCE_USED: ['paymentShortCode', 'distributorName', 'approvedAt'],
  WALLET_INSUFFICIENT_BALANCE: ['requiredPaisa', 'balancePaisa', 'shortByPaisa'],
  WALLET_ADJUST_EXCEEDS_BALANCE: ['balancePaisa'],
  FILE_TOO_LARGE: ['maxMb'],
  EXPENSE_TYPE_NAME_TAKEN: ['name'],
  EXPENSE_TYPE_ARCHIVED: ['name'],
  EXPENSE_TYPE_LOCKED: ['name'],
  REFILL_TOO_MANY: ['max'],
  REFILL_WRONG_STEP: ['progress'],
  REFILL_CYLINDER_WRONG_SIZE: ['sizeLabel', 'progress'],
  REFILL_CYLINDER_NOT_EMPTY: ['progress'],
  REFILL_CYLINDER_ON_OTHER_REFILL: ['progress'],
  REFILL_COUNT_REACHED: ['requested', 'progress'],
  REFILL_CYLINDER_NOT_ON_THIS_REFILL: ['progress'],
  DAY_SHEET_WRONG_DATE: ['sheetDate', 'date'],
  DAY_SHEET_ROW_ERRORS: ['rows', 'total'],
} as const satisfies { readonly [C in keyof ErrorDetailsMap]: readonly (keyof ErrorDetailsMap[C] & string)[] };

/**
 * The documented `details` keys of each code: a runtime copy of {@link ErrorDetailsMap}. `progress` on
 * the scan codes is the §2.3 rule "scan refusals carry progress (§9.3)".
 */
export const ERROR_DETAIL_KEYS: Readonly<Partial<Record<ErrorCode, readonly string[]>>> = DETAIL_KEYS;

/** The JSON body of every API error (API_CONTRACT §2.1). */
export interface ErrorEnvelope<C extends ErrorCode = ErrorCode> {
  statusCode: number;
  code: C;
  /** One plain-English sentence; never a stack trace or internal text. */
  message: string;
  details: ErrorDetails<C>;
  /** Repeats `code` for old clients. */
  error: C;
  requestId: string;
  /** The request path, with `/c/<token>` redacted (Inc 2). */
  path: string;
  timestamp: IsoDateTime;
}

/** An error body narrowed by its `code`. */
export type AnyErrorEnvelope = { [C in ErrorCode]: ErrorEnvelope<C> }[ErrorCode];

// ---- Compile-time guards: a failure here is a catalogue mistake. ----
type Assert<T extends true> = T;
type TemplateParams<S extends string> = S extends `${string}{{${infer P}}}${infer Rest}`
  ? P | TemplateParams<Rest>
  : never;
type DropPaisa<K> = K extends `${infer Base}Paisa` ? Base : K;
type DocumentedParams<C extends ErrorCode> = DropPaisa<keyof ErrorDetails<C> & string>;
type UndocumentedParams = {
  [C in ErrorCode]: Exclude<TemplateParams<(typeof ERROR_MESSAGE_EN)[C]>, DocumentedParams<C>>;
}[ErrorCode];
type MissingDetailKeys = {
  [C in keyof ErrorDetailsMap]: Exclude<keyof ErrorDetailsMap[C], (typeof DETAIL_KEYS)[C][number]>;
}[keyof ErrorDetailsMap];
/** Every `{{param}}` in an English text is a documented details key once `Paisa` is dropped. */
type _ParamsAreDocumented = Assert<[UndocumentedParams] extends [never] ? true : false>;
/** `ERROR_DETAIL_KEYS` lists every key of `ErrorDetailsMap`. */
type _DetailKeysComplete = Assert<[MissingDetailKeys] extends [never] ? true : false>;
/** The location block codes are catalogue codes. */
type _BlockCodesExist = Assert<PricingBlockCode extends ErrorCode ? true : false>;
