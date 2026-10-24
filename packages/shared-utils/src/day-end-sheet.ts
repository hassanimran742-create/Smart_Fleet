/**
 * [Inc 3] The day-end sheet's rules shared by the sheet maker, the upload reader and the tests
 * (API_CONTRACT §10.2, settled points G09-03 to G09-05): reading the "Your count" words and "Why
 * different", and how a row compares with the app and what approval does with it.
 *
 * shared-utils has no dependencies, so the shared-types unions are repeated as `…Like` types here; the
 * contract-sync spec fails if a copy drifts.
 */

/** Where a cylinder is (shared-types `DayClosePlace`). NOT_FOUND is the sheet's "Missing" and the app's place for a LOST cylinder. */
export type DayClosePlaceLike = 'STORE' | 'VAN' | 'CUSTOMER' | 'NOT_FOUND';

/** A cylinder state on the sheet and in the comparison (shared-types `DayCloseState`; Damaged is FAULTY). */
export type DayCloseStateLike = 'FULL' | 'EMPTY' | 'PART_FILLED' | 'FAULTY' | 'LOST';

/** shared-types `DayCloseDiff`. */
export type DayCloseDiffLike = 'MATCH' | 'PLACE_DIFFERS' | 'STATE_DIFFERS' | 'PLACE_AND_STATE_DIFFER' | 'UNKNOWN_CYLINDER';

/** shared-types `DayCloseFix`. */
export type DayCloseFixLike = 'MOVE_TO_STORE' | 'SET_STATE' | 'MARK_LOST' | 'REGISTER' | 'NOTE_ONLY';

/** A cylinder's holder type as Prisma `CustodyType` spells it (DISTRIBUTOR is legacy and reads as the store). */
export type CustodyTypeLike = 'STORE' | 'VEHICLE' | 'CLIENT' | 'DISTRIBUTOR';

/** A cylinder state as Prisma `CylinderState` spells it. */
export type CylinderStateLike = 'FULL' | 'EMPTY' | 'FAULTY' | 'LOST' | 'PART_FILLED';

/** The words of the "where" columns (shared-types `DAY_SHEET_PLACE_WORDS`). */
const PLACE_WORDS: Readonly<Record<DayClosePlaceLike, string>> = {
  STORE: 'In my store',
  VAN: "On driver's van",
  CUSTOMER: 'With customer',
  NOT_FOUND: 'Missing',
};

/** The words of the "state" columns (shared-types `DAY_SHEET_STATE_WORDS`). */
const STATE_WORDS: Readonly<Record<Exclude<DayCloseStateLike, 'LOST'>, string>> = {
  FULL: 'Full',
  EMPTY: 'Empty',
  PART_FILLED: 'Part-filled',
  FAULTY: 'Damaged',
};

/** Lower case, trimmed, inner spaces collapsed, ’ (and ‘ ʼ) read as '. */
function normalWords(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const PLACE_BY_WORDS = new Map<string, DayClosePlaceLike>(
  (Object.keys(PLACE_WORDS) as DayClosePlaceLike[]).map((place) => [normalWords(PLACE_WORDS[place]), place]),
);
const STATE_BY_WORDS = new Map<string, Exclude<DayCloseStateLike, 'LOST'>>(
  (Object.keys(STATE_WORDS) as Array<Exclude<DayCloseStateLike, 'LOST'>>).map((state) => [
    normalWords(STATE_WORDS[state]).replace(/[-\s]/g, ''),
    state,
  ]),
);

/** The text of a cell: strings as they are, numbers and booleans as text, anything else (empty, a formula error) as blank. */
function cellText(cell: unknown): string {
  if (typeof cell === 'string') return cell;
  if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell);
  return '';
}

/** What a "Your count" cell holds: a blank (the same as the app), a word it knows, or something it doesn't. */
export type SheetWord<T> = { kind: 'BLANK' } | { kind: 'WORD'; value: T } | { kind: 'UNKNOWN'; text: string };

/**
 * Reads a "Your count: where" cell (API_CONTRACT §10.2): "In my store", "On driver's van", "With
 * customer" or "Missing", case-insensitively after trimming, with ’ read as '. A blank cell means the
 * same as the app. Anything else is UNKNOWN (row error PLACE_UNKNOWN).
 */
export function parseDaySheetPlace(cell: unknown): SheetWord<DayClosePlaceLike> {
  const text = cellText(cell);
  const words = normalWords(text);
  if (words === '') return { kind: 'BLANK' };
  const place = PLACE_BY_WORDS.get(words);
  return place ? { kind: 'WORD', value: place } : { kind: 'UNKNOWN', text: text.trim() };
}

/**
 * Reads a "Your count: state" cell (and the Extra cylinders sheet's "State"): "Full", "Empty",
 * "Part-filled" (the hyphen optional: "Part filled" and "Partfilled" read the same) or "Damaged" (FAULTY),
 * case-insensitively after trimming. A blank cell means the same as the app. Anything else is UNKNOWN
 * (row error STATE_UNKNOWN).
 */
export function parseDaySheetState(cell: unknown): SheetWord<Exclude<DayCloseStateLike, 'LOST'>> {
  const text = cellText(cell);
  const words = normalWords(text);
  if (words === '') return { kind: 'BLANK' };
  const state = STATE_BY_WORDS.get(words.replace(/[-\s]/g, ''));
  return state ? { kind: 'WORD', value: state } : { kind: 'UNKNOWN', text: text.trim() };
}

/** "Why different" is at least this long after cleaning on a differing row (REASON_REQUIRED). */
export const DAY_SHEET_REASON_MIN = 3;
/** "Why different" is cut to this many characters. */
export const DAY_SHEET_REASON_MAX = 200;

/**
 * Cleans a "Why different" cell (API_CONTRACT §10.2): line breaks and tabs become spaces, other control
 * characters are removed, spaces collapse, the text is trimmed and cut to 200 characters (code points).
 * Returns null when nothing is left. A differing row needs at least {@link DAY_SHEET_REASON_MIN}
 * characters of it (REASON_REQUIRED); a reason on a matching row is ignored.
 */
export function cleanDaySheetReason(cell: unknown): string | null {
  const text = cellText(cell);
  const cleaned = text
    .replace(/\r\n|\r|\n|\t/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  const cut = Array.from(cleaned).slice(0, DAY_SHEET_REASON_MAX).join('').trim();
  return cut === '' ? null : cut;
}

/** True when a cleaned reason is long enough for a differing row. */
export function isDaySheetReasonEnough(reason: string | null): boolean {
  return reason !== null && Array.from(reason).length >= DAY_SHEET_REASON_MIN;
}

/** The "where" words of a place (shared-types `DAY_SHEET_PLACE_WORDS`). */
export function daySheetPlaceWords(place: DayClosePlaceLike): string {
  return PLACE_WORDS[place];
}

/** The "state" words of a state; empty for LOST (the app says "Missing" instead). */
export function daySheetStateWords(state: DayCloseStateLike): string {
  return state === 'LOST' ? '' : STATE_WORDS[state];
}

/**
 * The "App says: where" cell of a cylinder: "In my store", "On driver's van · <plate>", "With customer ·
 * <customer name>", or "Missing" for a LOST cylinder (whatever its holder).
 */
export function appSaysWhere(app: { place: DayClosePlaceLike; plateNo?: string | null; customerName?: string | null }): string {
  const words = PLACE_WORDS[app.place];
  if (app.place === 'VAN' && app.plateNo) return `${words} · ${app.plateNo}`;
  if (app.place === 'CUSTOMER' && app.customerName) return `${words} · ${app.customerName}`;
  return words;
}

/**
 * The app's side of a comparison (API_CONTRACT §10.2): NOT_FOUND ("Missing") for a LOST cylinder, else
 * its holder: a store is STORE, a van VAN, a customer CUSTOMER.
 */
export function appDayClosePlace(cylinder: { custodyType: CustodyTypeLike; state: CylinderStateLike }): DayClosePlaceLike {
  if (cylinder.state === 'LOST') return 'NOT_FOUND';
  switch (cylinder.custodyType) {
    case 'VEHICLE':
      return 'VAN';
    case 'CLIENT':
      return 'CUSTOMER';
    default:
      return 'STORE';
  }
}

/** One cylinder row, as stored on its line: the app's place and state at upload, and the shop's count. */
export interface DayCloseCompareInput {
  /** The app's side; null for an extra number the app doesn't know. */
  app: { place: DayClosePlaceLike; state: DayCloseStateLike } | null;
  /** The shop's count; null for a blank cell (the same as the app). */
  sheet: { place: DayClosePlaceLike | null; state: DayCloseStateLike | null };
}

/**
 * What the shop's count means once blanks are filled in: a blank cell is the app's value, and a
 * "Missing" place means LOST, whatever state is written beside it.
 */
export function effectiveSheetCount(line: DayCloseCompareInput): { place: DayClosePlaceLike; state: DayCloseStateLike } | null {
  if (!line.app) return line.sheet.place ? { place: line.sheet.place, state: line.sheet.state ?? 'FULL' } : null;
  const place = line.sheet.place ?? line.app.place;
  if (place === 'NOT_FOUND') return { place, state: 'LOST' };
  // A LOST cylinder found again keeps no state of its own: a blank state is the sheet's job to fill (STATE_UNKNOWN).
  const state = line.sheet.state ?? line.app.state;
  return { place, state };
}

/**
 * How a row compares with the app (API_CONTRACT §10.2): MATCH, PLACE_DIFFERS, STATE_DIFFERS,
 * PLACE_AND_STATE_DIFFER, or UNKNOWN_CYLINDER for an extra number. A blank "Your count" cell means the
 * same as the app, and a cylinder row deleted from the sheet matches.
 */
export function deriveDayCloseDiff(line: DayCloseCompareInput): DayCloseDiffLike {
  if (!line.app) return 'UNKNOWN_CYLINDER';
  const sheet = effectiveSheetCount(line);
  if (!sheet) return 'MATCH';
  const placeDiffers = sheet.place !== line.app.place;
  const stateDiffers = sheet.state !== line.app.state;
  if (placeDiffers && stateDiffers) return 'PLACE_AND_STATE_DIFFER';
  if (placeDiffers) return 'PLACE_DIFFERS';
  if (stateDiffers) return 'STATE_DIFFERS';
  return 'MATCH';
}

/** A differing line's fix and what it sets: the holder (`toPlace`) and the state (`toState`), when it changes them. */
export interface DayCloseFixPlan {
  fix: DayCloseFixLike;
  /** STORE for MOVE_TO_STORE and REGISTER (the home store); null when the holder doesn't change. */
  toPlace: 'STORE' | null;
  /** The state the cylinder gets; null when it doesn't change. */
  toState: DayCloseStateLike | null;
}

/**
 * What approval does with a line (API_CONTRACT §10.2, settled point G09-03); null for a MATCH, which
 * needs nothing. The fix follows from the stored values:
 * - REGISTER: an extra number (UNKNOWN_CYLINDER): a new cylinder in the home store, with the row's state.
 * - MARK_LOST: the sheet says Missing. State LOST, holder unchanged.
 * - MOVE_TO_STORE: the sheet says In my store and the app has it on a van, with a customer or LOST.
 *   Holder: the home store; state: the sheet's state if given (else unchanged).
 * - NOTE_ONLY: the sheet says On driver's van or With customer and the app has it elsewhere. Nothing
 *   changes: the office checks it by hand.
 * - SET_STATE: the same place and another state.
 */
export function deriveDayCloseFix(line: DayCloseCompareInput): DayCloseFixPlan | null {
  const diff = deriveDayCloseDiff(line);
  if (diff === 'MATCH') return null;
  if (diff === 'UNKNOWN_CYLINDER') return { fix: 'REGISTER', toPlace: 'STORE', toState: line.sheet.state ?? 'FULL' };
  const app = line.app as NonNullable<DayCloseCompareInput['app']>;
  const sheet = effectiveSheetCount(line) as NonNullable<ReturnType<typeof effectiveSheetCount>>;
  if (sheet.place !== app.place) {
    if (sheet.place === 'NOT_FOUND') return { fix: 'MARK_LOST', toPlace: null, toState: 'LOST' };
    if (sheet.place === 'STORE') {
      const toState = line.sheet.state ?? (app.state === 'LOST' ? null : app.state);
      return { fix: 'MOVE_TO_STORE', toPlace: 'STORE', toState: toState !== null && toState !== app.state ? toState : null };
    }
    return { fix: 'NOTE_ONLY', toPlace: null, toState: null };
  }
  return { fix: 'SET_STATE', toPlace: null, toState: sheet.state };
}
