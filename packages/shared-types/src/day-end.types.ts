import type { IdName, IsoDate, IsoDateTime, UUID } from './common.types';

/**
 * [Inc 3] Day-end: a system-made sheet with one row per cylinder, uploaded by the shop and approved by
 * the office (API_CONTRACT §10.2, DATA_MODEL §5). Day-end never moves money and never refuses a scan.
 * Typed ahead so the apps and the API share one contract.
 */

/** Mirrors Prisma `DayCloseStatus`. Send-back and reopen return a day to OPEN. */
export type DayCloseStatus = 'OPEN' | 'SUBMITTED' | 'APPROVED';

/**
 * The stage people see, derived by `deriveDayEndStage` in shared-utils (API_CONTRACT §1.4) and sent as
 * `stage` on every day-end DTO. First match wins: APPROVED, WAITING_FOR_APPROVAL (SUBMITTED),
 * SENT_BACK (OPEN after a send-back or reopen with no upload since), READY (OPEN with an upload newer
 * than the newest sheet), NOT_STARTED (otherwise, or no day row).
 */
export const DAY_END_STAGES = ['NOT_STARTED', 'READY', 'SENT_BACK', 'WAITING_FOR_APPROVAL', 'APPROVED'] as const;
export type DayEndStage = (typeof DAY_END_STAGES)[number];

/** Mirrors Prisma `DayClosePlace`. NOT_FOUND is the sheet's "Missing" and the app's place for a LOST cylinder. */
export type DayClosePlace = 'STORE' | 'VAN' | 'CUSTOMER' | 'NOT_FOUND';

/** Mirrors Prisma `DayCloseDiff`. */
export type DayCloseDiff = 'MATCH' | 'PLACE_DIFFERS' | 'STATE_DIFFERS' | 'PLACE_AND_STATE_DIFFER' | 'UNKNOWN_CYLINDER';

/**
 * What approval does with a differing line (API_CONTRACT §10.2). NOTE_ONLY ("On driver's van" or
 * "With customer" when the app has it elsewhere) changes nothing: the office checks it by hand.
 */
export const DAY_CLOSE_FIXES = ['MOVE_TO_STORE', 'SET_STATE', 'MARK_LOST', 'REGISTER', 'NOTE_ONLY'] as const;
export type DayCloseFix = (typeof DAY_CLOSE_FIXES)[number];

/** A cylinder state as the sheet and the difference list use it (Damaged is FAULTY). */
export type DayCloseState = 'FULL' | 'EMPTY' | 'PART_FILLED' | 'FAULTY' | 'LOST';

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

/** The office's note shown to the shop while the stage is SENT_BACK. */
export interface DayEndOfficeNote {
  kind: 'SENT_BACK' | 'REOPENED';
  text: string;
  at: IsoDateTime;
}

/** Buttons the server allows on a day (API_CONTRACT §1.6, §10.2). */
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
  cutoffAt: IsoDateTime;
  summary: DayEndSummary;
  lastUpload: { uploadedAt: IsoDateTime; version: number; differences: number } | null;
  officeNote: DayEndOfficeNote | null;
  allowedActions: DayEndAction[];
}

/** `POST /day-end/:date/upload` (200). */
export interface DayEndUploadResult {
  version: number;
  differences: DayCloseDifferenceDto[];
  summary: DayEndSummary;
}

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

/**
 * Why a day-end sheet row can't be read (API_CONTRACT §10.2): the code in
 * `DAY_SHEET_ROW_ERRORS.details.rows[].code`, shown in the shop app as `dayEnd.rowError.<code>`.
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

/** The English of each row error: the row's `message` and the shop app's English resource. */
export const DAY_END_ROW_ERROR_EN: { readonly [C in DayEndRowErrorCode]: string } = {
  PLACE_UNKNOWN: "Your count: where must be In my store, On driver's van, With customer or Missing.",
  STATE_UNKNOWN: 'Your count: state must be Full, Empty, Part-filled or Damaged.',
  REASON_REQUIRED: 'Say why this row is different (at least 3 characters).',
  NOT_ON_LIST: "This number isn't one of your cylinders. Put new numbers on the Extra cylinders sheet.",
  DUPLICATE_NUMBER: 'This cylinder number is on the sheet more than once.',
  NUMBER_INVALID: "This isn't a cylinder number.",
  OTHER_SHOP_NUMBER: "This number is another shop's label. Call the office.",
  ON_LIST: 'This cylinder is already on the Cylinders sheet. Fill in its row there.',
  SIZE_UNKNOWN: 'Choose a size from the list, like 11.8 kg.',
};
