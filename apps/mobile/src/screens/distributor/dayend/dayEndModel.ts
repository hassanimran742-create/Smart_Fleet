import type {
  DayCloseDifferenceDto,
  DayCloseFix,
  DayClosePlace,
  DayCloseState,
  DayEndDayDto,
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
  /** "Download again" under the first step, once a sheet exists. */
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

/** The kinds present, in chip order; the chips show only with 2 or more. */
export function kindsPresent(differences: readonly DayCloseDifferenceDto[]): DiffKind[] {
  const found = new Set(differences.flatMap((line) => kindsOf(line.diff)));
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
  const kinds = kindsOf(line.diff);
  return { place: kinds.includes('PLACE'), state: kinds.includes('STATE') };
}

/** The state word of a SET_STATE fix ("Set to Damaged"); null for the other fixes. */
export function fixState(line: { fix: DayCloseFix; sheet: { state: DayCloseState | null } }): DayCloseState | null {
  return line.fix === 'SET_STATE' ? line.sheet.state : null;
}

/** Row errors listed on the phone; "and 8 more rows" says the rest. */
export const ROW_ERRORS_SHOWN = 20;
