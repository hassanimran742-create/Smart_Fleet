import type { DayCloseDifferenceDto, DayClosePlace, DayCloseState, DayEndStage } from '@smartfleet/shared-types';
import i18n from '../../i18n';
import { Chip, StatusChip } from '../../ui';

/**
 * Day-end in the office's words (UX_ADMIN §4.3, rulebook §4.2): the status chip, what the app and the
 * sheet say, the difference and the fix approval would apply. Never a code (DAY-022).
 */

/**
 * The kit's `dayEnd` kind: Waiting for sheet grey, Sheet uploaded blue with the upload icon, To approve
 * the amber clock, Sent back red, Approved green.
 */
export function DayEndStageChip({ stage }: { stage: DayEndStage }) {
  return <StatusChip kind="dayEnd" value={stage} />;
}

export function placeWord(place: DayClosePlace): string {
  return i18n.t(`dayend:review.place.${place}`);
}

export function stateWord(state: DayCloseState): string {
  return i18n.t(`dayend:review.state.${state}`);
}

/** What the app says: "In store · Full", "On a van · Full · LEA-101", "With customer · Empty · Sana", "Missing". */
export function appSays(line: DayCloseDifferenceDto): string | null {
  const { app } = line;
  if (!app) return null;
  const where = app.place === 'VAN' ? app.plateNo : app.place === 'CUSTOMER' ? app.customerName : null;
  return says(app.place, app.state, where);
}

/** What the sheet says; a blank "Your count" cell means the same as the app. */
export function sheetSays(line: DayCloseDifferenceDto): string | null {
  const place = line.sheet.place ?? line.app?.place ?? null;
  const state = line.sheet.state ?? line.app?.state ?? null;
  if (!place) return state ? stateWord(state) : null;
  return says(place, state, null);
}

function says(place: DayClosePlace, state: DayCloseState | null, where: string | null): string {
  const t = i18n.t;
  const placeText = placeWord(place);
  // A lost cylinder has no state of its own: "Missing".
  if (!state || state === 'LOST' || place === 'NOT_FOUND') {
    return where ? t('dayend:review.says.placeWhere', { place: placeText, where }) : placeText;
  }
  const stateText = stateWord(state);
  return where
    ? t('dayend:review.says.placeStateWhere', { place: placeText, state: stateText, where })
    : t('dayend:review.says.placeState', { place: placeText, state: stateText });
}

/** "Move to Ahmed Gas Store", "Set to Damaged", "Mark as lost", "Add to Ahmed Gas Store as new cylinder", "Check by hand". */
export function fixWords(line: DayCloseDifferenceDto, store: string): string {
  const t = i18n.t;
  const sheetState = line.sheet.state;
  switch (line.fix) {
    case 'MOVE_TO_STORE':
      return sheetState && sheetState !== 'LOST' && sheetState !== line.app?.state
        ? t('dayend:review.fix.MOVE_TO_STORE_STATE', { store, state: stateWord(sheetState) })
        : t('dayend:review.fix.MOVE_TO_STORE', { store });
    case 'SET_STATE':
      return t('dayend:review.fix.SET_STATE', { state: sheetState ? stateWord(sheetState) : '' });
    case 'MARK_LOST':
      return t('dayend:review.fix.MARK_LOST');
    case 'REGISTER':
      return t('dayend:review.fix.REGISTER', { store });
    default:
      return t('dayend:review.fix.NOTE_ONLY');
  }
}

/**
 * The Fix chip: what approval will do (blue), "Check by hand" when it changes nothing (grey), and the grey
 * "Skipped · moved since sheet" when the cylinder moved after the sheet was made, so approval leaves it.
 */
export function FixChip({ line, store }: { line: DayCloseDifferenceDto; store: string }) {
  if (line.movedSinceSheet) return <Chip tone="neutral">{i18n.t('dayend:review.skipped')}</Chip>;
  if (line.fix === 'NOTE_ONLY') return <Chip tone="neutral">{fixWords(line, store)}</Chip>;
  return <Chip tone="info">{fixWords(line, store)}</Chip>;
}

/** The kind filter (more than 10 rows): Place, State or a new number. */
export type DiffKind = 'all' | 'place' | 'state' | 'newNumber';

export function ofKind(line: DayCloseDifferenceDto, kind: DiffKind): boolean {
  switch (kind) {
    case 'place':
      return line.diff === 'PLACE_DIFFERS' || line.diff === 'PLACE_AND_STATE_DIFFER';
    case 'state':
      return line.diff === 'STATE_DIFFERS' || line.diff === 'PLACE_AND_STATE_DIFFER';
    case 'newNumber':
      return line.diff === 'UNKNOWN_CYLINDER';
    default:
      return true;
  }
}
