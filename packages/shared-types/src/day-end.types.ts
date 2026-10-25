import type { IdName, IsoDate, IsoDateTime, UUID } from './common.types';

/**
 * [Inc 3] Day-end: a system-made sheet with one row per cylinder, uploaded by the shop and approved by
 * the office (API_CONTRACT §10.2, DATA_MODEL §5). Day-end never moves money and never refuses a scan.
 */

/** Mirrors Prisma `DayCloseStatus`. Send-back and reopen return a day to OPEN; APPROVED is locked. */
export const DayCloseStatus = {
  OPEN: 'OPEN',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
} as const;
export type DayCloseStatus = (typeof DayCloseStatus)[keyof typeof DayCloseStatus];

/**
 * The stage people see, derived by `deriveDayEndStage` in shared-utils (API_CONTRACT §1.4) and sent as
 * `stage` on every day-end DTO. First match wins: APPROVED, WAITING_FOR_APPROVAL (SUBMITTED),
 * SENT_BACK (OPEN after a send-back or reopen with no upload since), READY (OPEN with an upload newer
 * than the newest sheet), NOT_STARTED (otherwise, or no day row).
 */
export const DAY_END_STAGES = ['NOT_STARTED', 'READY', 'SENT_BACK', 'WAITING_FOR_APPROVAL', 'APPROVED'] as const;
export type DayEndStage = (typeof DAY_END_STAGES)[number];

/**
 * Mirrors Prisma `DayClosePlace`. NOT_FOUND is the sheet's "Missing" and the app's place for a LOST
 * cylinder; otherwise the app's place is the holder: STORE, VAN or CUSTOMER.
 */
export const DayClosePlace = {
  STORE: 'STORE',
  VAN: 'VAN',
  CUSTOMER: 'CUSTOMER',
  NOT_FOUND: 'NOT_FOUND',
} as const;
export type DayClosePlace = (typeof DayClosePlace)[keyof typeof DayClosePlace];

/** Mirrors Prisma `DayCloseDiff`: how a sheet row compares with the app. */
export const DayCloseDiff = {
  MATCH: 'MATCH',
  PLACE_DIFFERS: 'PLACE_DIFFERS',
  STATE_DIFFERS: 'STATE_DIFFERS',
  PLACE_AND_STATE_DIFFER: 'PLACE_AND_STATE_DIFFER',
  UNKNOWN_CYLINDER: 'UNKNOWN_CYLINDER',
} as const;
export type DayCloseDiff = (typeof DayCloseDiff)[keyof typeof DayCloseDiff];

/**
 * What approval does with a differing line (API_CONTRACT §10.2, settled point G09-03). It is not stored:
 * it follows from the line's stored values (`deriveDayCloseFix` in shared-utils).
 * - MOVE_TO_STORE: the sheet says In my store and the app has it on a van, with a customer or LOST.
 *   Holder: the home store; state: the sheet's state if given. One ADJUSTED event.
 * - SET_STATE: the same place and another state. One ADJUSTED event.
 * - MARK_LOST: the sheet says Missing. State LOST, holder unchanged. One ADJUSTED event.
 * - REGISTER: an extra number. A new cylinder in the home store with the row's size and state and the
 *   next short number (not the sheet's); one REGISTERED event. Its label must be printed.
 * - NOTE_ONLY: the sheet says On driver's van or With customer and the app has it elsewhere. The sheet
 *   names no van or customer, so nothing changes: the office checks it by hand.
 */
export const DAY_CLOSE_FIXES = ['MOVE_TO_STORE', 'SET_STATE', 'MARK_LOST', 'REGISTER', 'NOTE_ONLY'] as const;
export type DayCloseFix = (typeof DAY_CLOSE_FIXES)[number];

/** A cylinder state as the sheet and the difference list use it (Damaged is FAULTY). */
export type DayCloseState = 'FULL' | 'EMPTY' | 'PART_FILLED' | 'FAULTY' | 'LOST';

// ---------- the sheet (API_CONTRACT §10.2): one contract for the sheet maker and the upload reader ----------

/** The hidden "About" sheet's `format` value. */
export const DAY_SHEET_FORMAT = 'smart-fleet-day-end/1';

/** The workbook's sheet names. "About" is hidden (exceljs state `veryHidden`). */
export const DAY_SHEET_NAMES = {
  CYLINDERS: 'Cylinders',
  EXTRA: 'Extra cylinders',
  ABOUT: 'About',
} as const;

/** The "Cylinders" sheet's header row (row 1), in order. The upload refuses a sheet whose headers changed. */
export const DAY_SHEET_CYLINDER_HEADERS = [
  'Cylinder number',
  'Size',
  'App says: where',
  'App says: state',
  'Your count: where',
  'Your count: state',
  'Why different',
] as const;

/** The "Extra cylinders" sheet's header row (row 1): numbers found that aren't on the list. */
export const DAY_SHEET_EXTRA_HEADERS = ['Cylinder number', 'Size', 'State'] as const;

/** The "About" sheet: column A the key, column B the value, one row each, in this order. */
export const DAY_SHEET_ABOUT_KEYS = ['format', 'distributorId', 'distributorCode', 'businessDate', 'sheetFileId'] as const;
export type DaySheetAboutKey = (typeof DAY_SHEET_ABOUT_KEYS)[number];

/** The "About" sheet's values. No HMAC: the sheet is the shop's own count, and the office approves every fix. */
export type DaySheetAbout = { [K in DaySheetAboutKey]: string };

/**
 * The words of the "where" columns. "App says: where" adds " · <plate>" for a van and " · <customer
 * name>" for a customer ("On driver's van · LEA-101"); "Your count: where" is the plain word. The upload
 * reads the words case-insensitively after trimming, with ’ read as ' (`parseDaySheetPlace`).
 */
export const DAY_SHEET_PLACE_WORDS: { readonly [P in DayClosePlace]: string } = {
  STORE: 'In my store',
  VAN: "On driver's van",
  CUSTOMER: 'With customer',
  NOT_FOUND: 'Missing',
};

/**
 * The words of the "state" columns (Damaged is FAULTY). A LOST cylinder's "App says: state" is empty.
 * The upload reads them case-insensitively, with the hyphen in Part-filled optional (`parseDaySheetState`).
 */
export const DAY_SHEET_STATE_WORDS: { readonly [S in Exclude<DayCloseState, 'LOST'>]: string } = {
  FULL: 'Full',
  EMPTY: 'Empty',
  PART_FILLED: 'Part-filled',
  FAULTY: 'Damaged',
};

/** The upload's limits (API_CONTRACT §10.2). */
export const DAY_SHEET_LIMITS = {
  /** The file: at most 2 MiB (2,097,152 bytes), else 413 FILE_TOO_LARGE `{ maxMb: 2 }`. */
  maxBytes: 2 * 1024 * 1024,
  maxMb: 2,
  /** The workbook unzipped: at most 20 MB, else 422 DAY_SHEET_UNREADABLE. */
  maxUnzippedBytes: 20 * 1024 * 1024,
  /** Rows on any one sheet, else 422 DAY_SHEET_UNREADABLE. */
  maxRowsPerSheet: 20_000,
  /** DAY_SHEET_ROW_ERRORS lists at most this many rows (`total` counts them all). */
  maxListedRowErrors: 100,
  /** "Why different" on a differing row: at least 3 characters after cleaning, cut to 200. */
  reasonMin: 3,
  reasonMax: 200,
  /** The shop's note on the submit. */
  submitNoteMax: 300,
} as const;

/** Which sheet a row error is on (`DAY_SHEET_ROW_ERRORS.details.rows[].sheet`). */
export type DaySheetName = 'CYLINDERS' | 'EXTRA';

// ---------- what the routes send ----------

/** One differing line, in the upload answer and the office review (API_CONTRACT §10.2). */
export interface DayCloseDifferenceDto {
  id: UUID;
  diff: Exclude<DayCloseDiff, 'MATCH'>;
  fix: DayCloseFix;
  /** "AG-C0042". */
  shortCode: string;
  sizeLabel: string | null;
  /** What the app says; null for a number the app doesn't know. */
  app: { place: DayClosePlace; state: DayCloseState | null; plateNo: string | null; customerName: string | null } | null;
  /** What the shop's count says. */
  sheet: { place: DayClosePlace | null; state: DayCloseState | null };
  /** "Why different", cleaned (3–200 characters). */
  note: string | null;
  /** True when the cylinder's last event is newer than the sheet time: approval skips its fix. */
  movedSinceSheet: boolean;
  /** Office review only. */
  lastScanAt?: IsoDateTime | null;
}

/** Live counts for the day (or the totals frozen at approval). */
export interface DayEndSummary {
  inStore: { total: number; bySize: { sizeLabel: string; count: number }[] };
  onVans: number;
  withCustomers: number;
  deliveredToday: number;
  takenBackToday: number;
  receivedToday: number;
}

/**
 * `day_closes.totals`, frozen at approval: an APPROVED day's summary is read from it, never recounted.
 * `byPlace` and `byState` count the distributor's cylinders at approval, `bySize` per size.
 */
export interface DayCloseTotals {
  summary: DayEndSummary;
  byPlace: { readonly [P in DayClosePlace]: number };
  byState: { readonly [S in DayCloseState]: number };
  bySize: { cylinderTypeId: UUID; sizeLabel: string; count: number }[];
  /** The cylinders counted (every cylinder of the distributor, LOST and FAULTY included). */
  cylinders: number;
  /** The approval's fixes: applied, skipped (moved since the sheet), unchanged (NOTE_ONLY) and registered. */
  fixes: { applied: number; skipped: number; unchanged: number; registered: number };
  frozenAt: IsoDateTime;
}

/** The office's note shown to the shop while the stage is SENT_BACK. */
export interface DayEndOfficeNote {
  kind: 'SENT_BACK' | 'REOPENED';
  text: string;
  at: IsoDateTime;
}

/** Buttons the server allows the shop on a day (API_CONTRACT §1.6, §10.2). */
export type DayEndAction = 'DOWNLOAD' | 'UPLOAD' | 'SUBMIT';

/** `GET /day-end` rows (the shop's days that have a row, newest first). */
export interface DayEndListItem {
  businessDate: IsoDate;
  status: DayCloseStatus;
  stage: DayEndStage;
  submittedAt: IsoDateTime | null;
  approvedAt: IsoDateTime | null;
  differences: number;
}

/** `GET /day-end/:date` (shop). */
export interface DayEndDayDto {
  businessDate: IsoDate;
  status: DayCloseStatus;
  stage: DayEndStage;
  /** The end of the business day: the next cut-off (2026-10-21 → 2026-10-21T22:00:00.000Z at 03:00 Karachi). */
  cutoffAt: IsoDateTime;
  summary: DayEndSummary;
  lastUpload: { uploadedAt: IsoDateTime; version: number; differences: number } | null;
  officeNote: DayEndOfficeNote | null;
  allowedActions: DayEndAction[];
}

/** `POST /day-end/:date/upload` (200). A refused upload stores nothing (422 DAY_SHEET_ROW_ERRORS and the rest). */
export interface DayEndUploadResult {
  version: number;
  differences: DayCloseDifferenceDto[];
  summary: DayEndSummary;
  /**
   * The cylinders the upload checked: every cylinder of the shop on the sheet (lost and damaged ones
   * included) plus each extra row ("35 cylinders checked").
   */
  checked: number;
}

/** Buttons the server allows the office on a day: approve or send back a SUBMITTED day, reopen an APPROVED one. */
export type AdminDayEndAction = 'APPROVE' | 'SEND_BACK' | 'REOPEN';

/** `GET /admin/day-end` rows (office). Tabs: To approve SUBMITTED, Open OPEN, Locked APPROVED. */
export interface AdminDayEndListItem {
  id: UUID;
  businessDate: IsoDate;
  distributor: { id: UUID; businessName: string };
  status: DayCloseStatus;
  stage: DayEndStage;
  version: number;
  differences: number;
  uploadedAt: IsoDateTime | null;
  uploadedBy: IdName | null;
}

/** `GET /admin/day-end/:id` (office). Both files open through `GET /files/:id/url`. */
export interface AdminDayEndDetail extends AdminDayEndListItem {
  summary: DayEndSummary;
  fixesToApply: DayCloseDifferenceDto[];
  lines: DayCloseDifferenceDto[];
  files: { sheetFileId: UUID | null; uploadFileId: UUID | null };
  /** [Inc 3] When the shop sent it, when the office approved it, and the office's latest note. */
  submittedAt?: IsoDateTime | null;
  approvedAt?: IsoDateTime | null;
  approvedBy?: IdName | null;
  officeNote?: DayEndOfficeNote | null;
  allowedActions?: AdminDayEndAction[];
}

/** A cylinder that approval registered (`REGISTER` fix) or bulk registration made, for its label. */
export interface RegisteredCylinderDto {
  id: UUID;
  code: string;
  shortNo: number;
  /** "AG-C0036". */
  shortCode: string;
  sizeLabel: string;
}

/** `POST /admin/day-end/:id/approve` (200): the locked day and the cylinders it registered, so their labels can be printed. */
export interface DayEndApproveResult {
  day: AdminDayEndDetail;
  registered: RegisteredCylinderDto[];
}

/**
 * Why a day-end sheet row can't be read (API_CONTRACT §10.2): the code in
 * `DAY_SHEET_ROW_ERRORS.details.rows[].code`, shown in the shop app as `dayEnd.rowError.<code>`.
 * Cylinders sheet, in this order: NUMBER_INVALID, OTHER_SHOP_NUMBER, NOT_ON_LIST, DUPLICATE_NUMBER, then
 * PLACE_UNKNOWN, STATE_UNKNOWN, then REASON_REQUIRED. Extra cylinders sheet: NUMBER_INVALID,
 * OTHER_SHOP_NUMBER, ON_LIST, DUPLICATE_NUMBER, then SIZE_UNKNOWN, STATE_UNKNOWN.
 */
export const DAY_END_ROW_ERROR_CODES = [
  'PLACE_UNKNOWN',
  'STATE_UNKNOWN',
  'REASON_REQUIRED',
  'NOT_ON_LIST',
  'DUPLICATE_NUMBER',
  'NUMBER_INVALID',
  'OTHER_SHOP_NUMBER',
  'ON_LIST',
  'SIZE_UNKNOWN',
] as const;
export type DayEndRowErrorCode = (typeof DAY_END_ROW_ERROR_CODES)[number];

/**
 * The English of each row error: the row's `message` and the shop app's English resource. The shorter
 * texts of the Inc 2–3 screen spec (§4.7, at most 12 words each); REASON_REQUIRED keeps its rule (at least
 * 3 characters) and drops it from the words.
 */
export const DAY_END_ROW_ERROR_EN: { readonly [C in DayEndRowErrorCode]: string } = {
  PLACE_UNKNOWN: "Where: use In my store, On driver's van, With customer or Missing.",
  STATE_UNKNOWN: 'State: use Full, Empty, Part-filled or Damaged.',
  REASON_REQUIRED: 'Write why this row is different.',
  NOT_ON_LIST: 'Not your cylinder. Put new numbers on Extra cylinders.',
  DUPLICATE_NUMBER: 'This number is on the sheet twice.',
  NUMBER_INVALID: "This isn't a cylinder number.",
  OTHER_SHOP_NUMBER: "Another shop's label. Call the office.",
  ON_LIST: 'Already on the Cylinders sheet. Fill in its row there.',
  SIZE_UNKNOWN: 'Pick a size from the list, like 11.8 kg.',
};
