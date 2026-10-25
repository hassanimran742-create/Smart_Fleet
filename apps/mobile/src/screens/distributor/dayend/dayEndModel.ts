import type {
  DayCloseDifferenceDto,
  DayCloseFix,
  DayClosePlace,
  DayCloseState,
  DayEndDayDto,
  DayEndListItem,
  DayEndStage,
  DayEndUploadResult,
  DaySheetRowError,
} from '@smartfleet/shared-types';

/**
 * [Inc 3] The rules of the shop's Day-end (S19) and Check and send (S20) (UX_MOBILE §8.3; Inc 2/3 spec
 * §4.6–§4.7), as plain logic over the day-end DTOs. It imports only shared-types, so the API's unit
 * tests can load it.
 */

export type StepState = 'done' | 'current' | 'todo';
/** The footer's one main button, by `allowedActions` and the stage. */
export type DayFooter = 'download' | 'upload' | 'send' | null;

export interface DayEndView {
  steps: { download: StepState; fill: StepState; upload: StepState };
  footer: DayFooter;
  /**
   * "Download again" under the first step, once a sheet exists. It always comes with the line "Your
   * filled sheet can't be sent after this.": only the newest sheet can be uploaded, so a new one makes
   * the filled copy (and an upload made from it) unusable (review23 ux-07).
   */
  downloadAgain: boolean;
  /** "Upload again" under the third step, while the upload waits to be sent. */
  uploadAgain: boolean;
  /** "The office is checking it." (no footer then). */
  waiting: boolean;
  /** The red card while the day is sent back or reopened. */
  note: DayEndDayDto['officeNote'];
}

export function dayEndView(day: DayEndDayDto): DayEndView {
  const can = (action: DayEndDayDto['allowedActions'][number]) => day.allowedActions.includes(action);
  // An upload newer than the newest sheet: READY, then with the office, then approved.
  const uploaded = day.stage === 'READY' || day.stage === 'WAITING_FOR_APPROVAL' || day.stage === 'APPROVED';
  // UPLOAD is allowed only once a sheet was made for the day.
  const sheetMade = uploaded || can('UPLOAD');
  let footer: DayFooter = null;
  if (day.stage === 'READY' && can('SUBMIT')) footer = 'send';
  else if (!uploaded && can('UPLOAD')) footer = 'upload';
  else if (!sheetMade && can('DOWNLOAD')) footer = 'download';
  return {
    steps: {
      download: sheetMade ? 'done' : 'current',
      fill: uploaded ? 'done' : sheetMade ? 'current' : 'todo',
      upload: uploaded ? 'done' : 'todo',
    },
    footer,
    downloadAgain: sheetMade && can('DOWNLOAD'),
    uploadAgain: day.stage === 'READY' && can('UPLOAD'),
    waiting: day.stage === 'WAITING_FOR_APPROVAL',
    note: day.stage === 'SENT_BACK' ? day.officeNote : null,
  };
}

/**
 * Why a day waits for the shop: the office sent it back or reopened it (stage SENT_BACK, with the
 * office's note), or an earlier day was started and never sent: uploaded and waiting to be sent (READY),
 * or a sheet was downloaded and nothing sent (NOT_SENT; a day has a row only once its sheet is made).
 */
export type DayEndDue = 'SENT_BACK' | 'READY' | 'NOT_SENT';

/** The day Home's "Day-end sheet" row names and S19 opens on. */
export interface DayEndTarget {
  date: string;
  /** Set when that day waits for the shop; null for today with nothing due. */
  due: DayEndDue | null;
  /** The day's stage; a date with no row reads NOT_STARTED. */
  stage: DayEndStage;
}

/**
 * Which day the shop's Day-end opens on (review23 ux-01, robustness-jobs-04): a send-back or reopen
 * after the 3 am cut-off, or a sheet downloaded just before it, would otherwise never be reachable,
 * since `today` has moved on. In order:
 * 1. the oldest day the office sent back or reopened (stage SENT_BACK, today included);
 * 2. the oldest earlier day still OPEN: uploaded and not sent (READY), or a sheet made and nothing sent;
 * 3. today.
 * `days` is the first page of `GET /day-end` (newest first, the shop's days that have a row); `today` is
 * the current business date. A day with the office (SUBMITTED) or approved never waits for the shop.
 */
export function dayEndTarget(days: readonly DayEndListItem[], today: string): DayEndTarget {
  const open = days.filter((day) => day.status === 'OPEN' && day.businessDate <= today);
  const oldest = (list: DayEndListItem[]): DayEndListItem =>
    list.reduce((found, day) => (day.businessDate < found.businessDate ? day : found));
  const sentBack = open.filter((day) => day.stage === 'SENT_BACK');
  if (sentBack.length > 0) {
    const day = oldest(sentBack);
    return { date: day.businessDate, due: 'SENT_BACK', stage: day.stage };
  }
  const unsent = open.filter((day) => day.businessDate < today);
  if (unsent.length > 0) {
    const day = oldest(unsent);
    return { date: day.businessDate, due: day.stage === 'READY' ? 'READY' : 'NOT_SENT', stage: day.stage };
  }
  return { date: today, due: null, stage: days.find((day) => day.businessDate === today)?.stage ?? 'NOT_STARTED' };
}

/**
 * True for the server's "The service is busy. Please try again in a minute." (503 SERVICE_UNAVAILABLE):
 * it reads one day-end sheet at a time and turns a sheet away while two wait (API_CONTRACT §10.5), so the
 * same file can simply be sent again: the error offers "Try again" (review23 security-02). A 429 says how
 * many minutes to wait instead, so it offers none.
 */
export function isBusyRefusal(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'SERVICE_UNAVAILABLE';
}

/** What the last upload answered: its differences, or its row errors (nothing was saved then). */
export type DayUpload =
  | { kind: 'result'; result: DayEndUploadResult; at: number }
  | { kind: 'rowErrors'; rows: DaySheetRowError[]; total: number; at: number };

/**
 * Every cylinder the upload checked ("35 cylinders checked"): the server's count (lost and damaged ones
 * and extra rows included); an older answer without it adds the store, the vans and the customers.
 */
export function checkedCount(result: Pick<DayEndUploadResult, 'summary'> & { checked?: number }): number {
  if (typeof result.checked === 'number') return result.checked;
  const { summary } = result;
  return summary.inStore.total + summary.onVans + summary.withCustomers;
}

export type DiffKind = 'PLACE' | 'STATE' | 'NEW';
const KIND_ORDER: readonly DiffKind[] = ['PLACE', 'STATE', 'NEW'];

export function kindsOf(diff: DayCloseDifferenceDto['diff']): DiffKind[] {
  switch (diff) {
    case 'PLACE_DIFFERS':
      return ['PLACE'];
    case 'STATE_DIFFERS':
      return ['STATE'];
    case 'PLACE_AND_STATE_DIFFER':
      return ['PLACE', 'STATE'];
    case 'UNKNOWN_CYLINDER':
      return ['NEW'];
  }
}

/**
 * A line's kinds as the shop reads them: a cylinder marked Missing is a place difference only (the server
 * also counts its state, LOST, as different, but a missing cylinder has no state to check).
 */
export function lineKinds(line: Pick<DayCloseDifferenceDto, 'diff' | 'sheet'>): DiffKind[] {
  const kinds = kindsOf(line.diff);
  return line.sheet.place === 'NOT_FOUND' ? kinds.filter((kind) => kind !== 'STATE') : kinds;
}

/** The kinds present, in chip order; the chips show only with 2 or more. */
export function kindsPresent(differences: readonly DayCloseDifferenceDto[]): DiffKind[] {
  const found = new Set(differences.flatMap((line) => lineKinds(line)));
  return KIND_ORDER.filter((kind) => found.has(kind));
}

/** The shop's count of a line: a blank cell means the same as the app. */
export function yourCount(line: DayCloseDifferenceDto): { place: DayClosePlace | null; state: DayCloseState | null } {
  return {
    place: line.sheet.place ?? line.app?.place ?? null,
    state: line.sheet.state ?? line.app?.state ?? null,
  };
}

/** Which parts of "You: …" are in bold: the ones that differ from the app. */
export function differingParts(line: DayCloseDifferenceDto): { place: boolean; state: boolean } {
  const kinds = lineKinds(line);
  return { place: kinds.includes('PLACE'), state: kinds.includes('STATE') };
}

/** The state word of a SET_STATE fix ("Set to Damaged"); null for the other fixes. */
export function fixState(line: { fix: DayCloseFix; sheet: { state: DayCloseState | null } }): DayCloseState | null {
  return line.fix === 'SET_STATE' ? line.sheet.state : null;
}

/** Row errors listed on the phone; "and 8 more rows" says the rest. */
export const ROW_ERRORS_SHOWN = 20;
