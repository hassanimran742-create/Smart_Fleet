import type { CustodyType, CylinderState, DayClosePlace } from '@prisma/client';
import {
  DAY_END_ROW_ERROR_EN,
  type DayEndRowErrorCode,
  type DaySheetName,
  type DaySheetRowError,
} from '@smartfleet/shared-types';
import {
  appDayClosePlace,
  cleanDaySheetReason,
  deriveDayCloseDiff,
  formatNo,
  isDaySheetReasonEnough,
  parseCylinderNo,
  parseDaySheetPlace,
  parseDaySheetState,
  type DayClosePlaceLike,
  type DayCloseStateLike,
} from '@smartfleet/shared-utils';
import type { UploadedDaySheet } from './day-end-workbook';

/**
 * [Inc 3] The day-end sheet's row rules (API_CONTRACT §10.2 "Row rules", settled points G09-01, G09-04,
 * G09-05). Pure: it reads the uploaded rows against the caller's own cylinders and the sizes, and returns
 * every row error (each row gets the code of the first rule it breaks) or what each readable row says.
 *
 * - Numbers read like a typed number (`parseCylinderNo`): "42", "0042", "C0042" or "AG-C0042", any letter
 *   case. A number with another shop's code is OTHER_SHOP_NUMBER, decided from the code alone: other
 *   shops' cylinders are never looked up.
 * - Cylinders sheet, in this order: NUMBER_INVALID, OTHER_SHOP_NUMBER, NOT_ON_LIST, DUPLICATE_NUMBER
 *   (a later row naming a cylinder already read), PLACE_UNKNOWN, STATE_UNKNOWN (also a LOST cylinder
 *   reported In my store with no state), then REASON_REQUIRED (a differing row needs "Why different" of at
 *   least 3 characters after cleaning). A blank "Your count" cell means the same as the app.
 * - Extra cylinders sheet, in this order: NUMBER_INVALID, OTHER_SHOP_NUMBER, ON_LIST, DUPLICATE_NUMBER,
 *   SIZE_UNKNOWN, STATE_UNKNOWN.
 */

/** One of the caller's cylinders, as the rules and the lines read it. */
export interface DistributorCylinder {
  id: string;
  shortNo: number;
  cylinderTypeId: string;
  state: CylinderState;
  custodyType: CustodyType;
  custodyId: string;
  lastEventId: string | null;
  /** When its last move was written; null when it has none. */
  lastEventAt: Date | null;
}

/** A size the Extra cylinders sheet may name. */
export interface SizeOption {
  cylinderTypeId: string;
  /** "11.8 kg". */
  label: string;
  code: string;
  name: string;
  weightKg: number;
}

/** What a readable Cylinders row says (its raw "Your count" values: null is a blank cell). */
export interface CountedRow {
  row: number;
  reportedPlace: DayClosePlace | null;
  reportedState: CylinderState | null;
  /** "Why different", cleaned; only kept on a differing row. */
  note: string | null;
}

/** A readable Extra cylinders row: a number the app doesn't know, registered on approval. */
export interface ExtraRow {
  row: number;
  shortNo: number;
  /** The number in its normal form, "AG-C0099" (the new cylinder gets the next short number instead). */
  sheetKey: string;
  cylinderTypeId: string;
  sizeLabel: string;
  state: CylinderState;
}

export interface RowRulesResult {
  /** Every row error, in sheet order (Cylinders first) then row order. */
  errors: DaySheetRowError[];
  /** The readable Cylinders rows, by cylinder id. Cylinders without a row match. */
  counts: Map<string, CountedRow>;
  extras: ExtraRow[];
}

function rowError(sheet: DaySheetName, row: number, code: DayEndRowErrorCode): DaySheetRowError {
  return { sheet, row, code, message: DAY_END_ROW_ERROR_EN[code] };
}

/** The app's side of a comparison: NOT_FOUND ("Missing") for a LOST cylinder, else its holder. */
export function appSideOf(cylinder: Pick<DistributorCylinder, 'custodyType' | 'state'>): { place: DayClosePlaceLike; state: DayCloseStateLike } {
  return { place: appDayClosePlace({ custodyType: cylinder.custodyType, state: cylinder.state }), state: cylinder.state };
}

/** The size an Extra cylinders "Size" cell names: its words ("11.8 kg", any case and spacing), its weight ("11.8") or its code. */
export function matchSize(text: string, sizes: readonly SizeOption[]): SizeOption | null {
  const compact = text.replace(/\s+/g, '').toLowerCase();
  if (!compact) return null;
  const byWords = sizes.find(
    (size) =>
      compact === size.label.replace(/\s+/g, '').toLowerCase() ||
      compact === size.code.replace(/\s+/g, '').toLowerCase() ||
      compact === size.name.replace(/\s+/g, '').toLowerCase(),
  );
  if (byWords) return byWords;
  const weight = /^(\d{1,3}(?:[.,]\d{1,3})?)(?:kgs?)?$/.exec(compact);
  if (!weight) return null;
  const kg = Number(weight[1].replace(',', '.'));
  return sizes.find((size) => Math.abs(size.weightKg - kg) < 1e-9) ?? null;
}

/** Applies the row rules to an uploaded sheet (see the file comment). */
export function applyRowRules(p: {
  distributorCode: string;
  cylinders: readonly DistributorCylinder[];
  sizes: readonly SizeOption[];
  sheet: UploadedDaySheet;
}): RowRulesResult {
  const code = p.distributorCode.trim().toUpperCase();
  const byShortNo = new Map(p.cylinders.map((cylinder) => [cylinder.shortNo, cylinder]));
  const errors: DaySheetRowError[] = [];
  const counts = new Map<string, CountedRow>();

  /** The number of a row: null (NUMBER_INVALID), 'OTHER' (another shop's code) or the short number. */
  const readNumber = (text: string): number | 'OTHER' | null => {
    const parsed = parseCylinderNo(text);
    if (!parsed) return null;
    if (parsed.code !== null && parsed.code !== code) return 'OTHER';
    return parsed.shortNo;
  };

  for (const row of p.sheet.cylinders) {
    const no = readNumber(row.number);
    if (no === null) {
      errors.push(rowError('CYLINDERS', row.row, 'NUMBER_INVALID'));
      continue;
    }
    if (no === 'OTHER') {
      errors.push(rowError('CYLINDERS', row.row, 'OTHER_SHOP_NUMBER'));
      continue;
    }
    const cylinder = byShortNo.get(no);
    if (!cylinder) {
      errors.push(rowError('CYLINDERS', row.row, 'NOT_ON_LIST'));
      continue;
    }
    if (counts.has(cylinder.id)) {
      errors.push(rowError('CYLINDERS', row.row, 'DUPLICATE_NUMBER'));
      continue;
    }
    const where = parseDaySheetPlace(row.where);
    if (where.kind === 'UNKNOWN') {
      errors.push(rowError('CYLINDERS', row.row, 'PLACE_UNKNOWN'));
      counts.set(cylinder.id, { row: row.row, reportedPlace: null, reportedState: null, note: null });
      continue;
    }
    const state = parseDaySheetState(row.state);
    if (state.kind === 'UNKNOWN') {
      errors.push(rowError('CYLINDERS', row.row, 'STATE_UNKNOWN'));
      counts.set(cylinder.id, { row: row.row, reportedPlace: null, reportedState: null, note: null });
      continue;
    }
    const reportedPlace = where.kind === 'WORD' ? (where.value as DayClosePlace) : null;
    const reportedState = state.kind === 'WORD' ? (state.value as CylinderState) : null;
    // Read once: a later row with the same number is a duplicate, whatever this row says.
    counts.set(cylinder.id, { row: row.row, reportedPlace, reportedState, note: null });
    const app = appSideOf(cylinder);
    if (app.state === 'LOST' && reportedPlace === 'STORE' && reportedState === null) {
      errors.push(rowError('CYLINDERS', row.row, 'STATE_UNKNOWN'));
      continue;
    }
    const diff = deriveDayCloseDiff({ app, sheet: { place: reportedPlace, state: reportedState } });
    if (diff === 'MATCH') continue;
    const note = cleanDaySheetReason(row.why);
    if (!isDaySheetReasonEnough(note)) {
      errors.push(rowError('CYLINDERS', row.row, 'REASON_REQUIRED'));
      continue;
    }
    counts.set(cylinder.id, { row: row.row, reportedPlace, reportedState, note });
  }

  const extras: ExtraRow[] = [];
  const extraSeen = new Set<number>();
  for (const row of p.sheet.extra) {
    const no = readNumber(row.number);
    if (no === null) {
      errors.push(rowError('EXTRA', row.row, 'NUMBER_INVALID'));
      continue;
    }
    if (no === 'OTHER') {
      errors.push(rowError('EXTRA', row.row, 'OTHER_SHOP_NUMBER'));
      continue;
    }
    if (byShortNo.has(no)) {
      errors.push(rowError('EXTRA', row.row, 'ON_LIST'));
      continue;
    }
    if (extraSeen.has(no)) {
      errors.push(rowError('EXTRA', row.row, 'DUPLICATE_NUMBER'));
      continue;
    }
    extraSeen.add(no);
    const size = matchSize(row.size, p.sizes);
    if (!size) {
      errors.push(rowError('EXTRA', row.row, 'SIZE_UNKNOWN'));
      continue;
    }
    const state = parseDaySheetState(row.state);
    if (state.kind !== 'WORD') {
      errors.push(rowError('EXTRA', row.row, 'STATE_UNKNOWN'));
      continue;
    }
    extras.push({
      row: row.row,
      shortNo: no,
      sheetKey: formatNo(code, 'CYLINDER', no),
      cylinderTypeId: size.cylinderTypeId,
      sizeLabel: size.label,
      state: state.value as CylinderState,
    });
  }

  // Cylinders rows were read before Extra rows, each sheet top to bottom: already in sheet and row order.
  return { errors, counts, extras };
}
