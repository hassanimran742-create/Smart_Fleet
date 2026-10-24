/**
 * REF-030: every refill and day-end error code has its HTTP status, its English text from API_CONTRACT
 * §2.3 (Refills, Day-end, Settings and legacy) and an `errors.<CODE>` key in both apps, and renders with
 * its details into plain English (dates with formatIsoDay, API_CONTRACT §2.1).
 */
import {
  ERROR_DETAIL_KEYS,
  ERROR_HTTP,
  ERROR_MESSAGE_EN,
  isErrorCode,
  type ErrorCode,
} from '@smartfleet/shared-types';
import { renderMessage } from '@smartfleet/shared-utils';

/** API_CONTRACT §2.3, Refills, Day-end and the Inc 3 legacy row: status and English, as the catalogue lists them. */
const CATALOGUE_INC3: ReadonlyArray<[string, number, string]> = [
  ['REFILL_DIY_RETIRED', 410, 'Do-it-yourself refills are no longer used. Request a refill instead.'],
  ['REFILL_TOO_MANY', 400, 'Too many cylinders. A refill can have at most {{max}}.'],
  ['REFILL_NOT_CANCELLABLE', 409, "This refill can't be cancelled after pickup."],
  ['REFILL_INVALID_COUNT', 400, 'Check the number of cylinders.'],
  ['REFILL_STATION_INACTIVE', 409, "This station isn't taking refills."],
  ['REFILL_WRONG_STEP', 409, "This refill isn't at that step."],
  ['REFILL_CYLINDER_WRONG_SIZE', 409, 'This refill is for {{sizeLabel}} only.'],
  ['REFILL_CYLINDER_NOT_EMPTY', 409, 'Only empty or part-filled cylinders go for refill.'],
  ['REFILL_CYLINDER_ON_OTHER_REFILL', 409, 'This cylinder is already on another refill.'],
  ['REFILL_COUNT_REACHED', 409, 'All picked up: {{requested}} of {{requested}}.'],
  ['REFILL_CYLINDER_NOT_ON_THIS_REFILL', 409, "This cylinder wasn't picked up for this refill."],
  ['REFILL_USE_SCANS', 410, 'Update the app to continue.'],
  ['REFILL_AUTO_COMPLETES', 410, 'Refills now finish by themselves when the store scans them in.'],
  ['DAY_NOT_FOUND', 404, "We couldn't find this day."],
  ['DAY_LOCKED', 409, 'This day is closed. Ask the office to reopen it.'],
  ['DAY_SHEET_UNREADABLE', 422, "This file isn't the day-end sheet. Download today's sheet and try again."],
  ['DAY_SHEET_WRONG_DISTRIBUTOR', 422, 'This sheet belongs to another shop.'],
  ['DAY_SHEET_WRONG_DATE', 422, 'This sheet is for {{sheetDate}}. Upload the sheet for {{date}}.'],
  ['DAY_SHEET_OUTDATED', 422, 'This is an old copy. Download a new sheet and use that.'],
  ['DAY_SHEET_ROW_ERRORS', 422, "Some rows couldn't be read. Fix them and upload again."],
  ['DAY_ALREADY_SUBMITTED', 409, 'This day was already sent for approval.'],
  ['DAY_NOT_SUBMITTED', 409, "This day hasn't been sent for approval."],
  ['DAY_SHEET_NOT_UPLOADED', 409, 'Upload the filled sheet first.'],
  ['DAY_VERSION_CHANGED', 409, 'A newer sheet was uploaded. Load the new version.'],
  ['RECONCILIATION_RETIRED', 410, 'The day-end sheet replaces this form.'],
];

/** Sample details for every code (REF-030 step 4). */
const SAMPLE_DETAILS: Record<string, Record<string, unknown>> = {
  REFILL_TOO_MANY: { max: 30 },
  REFILL_CYLINDER_WRONG_SIZE: { sizeLabel: '11.8 kg' },
  REFILL_COUNT_REACHED: { requested: 2 },
  DAY_SHEET_WRONG_DATE: { sheetDate: '2026-10-20', date: '2026-10-21' },
  DAY_SHEET_ROW_ERRORS: { rows: [], total: 0 },
  FILE_TOO_LARGE: { maxMb: 2 },
};

describe('REF-030 refill and day-end error codes', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const mobile = require('../../../../mobile/src/i18n/en/errors').errors as Record<string, string>;
  const web = require('../../../../admin-web/src/i18n/en/errors').errors as Record<string, string>;
  /* eslint-enable @typescript-eslint/no-var-requires */

  it('REF-030 every code has its §2.3 HTTP status and English text, and an errors.<CODE> key in both apps', () => {
    for (const [code, status, english] of CATALOGUE_INC3) {
      expect({ code, known: isErrorCode(code) }).toEqual({ code, known: true });
      expect({ code, status: ERROR_HTTP[code as ErrorCode], english: ERROR_MESSAGE_EN[code as ErrorCode] }).toEqual({ code, status, english });
      expect({ code, mobile: mobile[code], web: web[code] }).toEqual({ code, mobile: english, web: english });
    }
    // The statuses REF-030 lists: 410 for the three retirements, 400 for the two count checks, 409 for the
    // other eight refill codes; 404, 422 and 409 for the day-end codes; 410 for the old reconciliation form.
    const refill = CATALOGUE_INC3.filter(([code]) => code.startsWith('REFILL_'));
    expect(refill.filter(([, status]) => status === 409)).toHaveLength(8);
    expect(refill.filter(([, status]) => status === 410).map(([code]) => code)).toEqual(['REFILL_DIY_RETIRED', 'REFILL_USE_SCANS', 'REFILL_AUTO_COMPLETES']);
    expect(refill.filter(([, status]) => status === 400).map(([code]) => code)).toEqual(['REFILL_TOO_MANY', 'REFILL_INVALID_COUNT']);
  });

  it('REF-030 each message renders with sample details into plain English, with no {{…}} left', () => {
    for (const [code] of CATALOGUE_INC3) {
      const message = renderMessage(ERROR_MESSAGE_EN[code as ErrorCode], SAMPLE_DETAILS[code] ?? {});
      expect({ code, message }).toEqual({ code, message: expect.not.stringMatching(/\{\{|\}\}/) });
    }
    expect(renderMessage(ERROR_MESSAGE_EN.REFILL_CYLINDER_WRONG_SIZE, SAMPLE_DETAILS.REFILL_CYLINDER_WRONG_SIZE)).toBe('This refill is for 11.8 kg only.');
    expect(renderMessage(ERROR_MESSAGE_EN.REFILL_COUNT_REACHED, SAMPLE_DETAILS.REFILL_COUNT_REACHED)).toBe('All picked up: 2 of 2.');
    expect(renderMessage(ERROR_MESSAGE_EN.REFILL_TOO_MANY, SAMPLE_DETAILS.REFILL_TOO_MANY)).toBe('Too many cylinders. A refill can have at most 30.');
    expect(renderMessage(ERROR_MESSAGE_EN.DAY_SHEET_WRONG_DATE, SAMPLE_DETAILS.DAY_SHEET_WRONG_DATE)).toBe(
      'This sheet is for Tue 20 Oct. Upload the sheet for Wed 21 Oct.',
    );
    expect(renderMessage(ERROR_MESSAGE_EN.FILE_TOO_LARGE, SAMPLE_DETAILS.FILE_TOO_LARGE)).toBe('This file is too big. The limit is 2 MB.');
  });

  it('REF-030 the codes with details document their keys (refill refusals carry the progress)', () => {
    expect(ERROR_DETAIL_KEYS.REFILL_TOO_MANY).toEqual(['max']);
    expect(ERROR_DETAIL_KEYS.REFILL_CYLINDER_WRONG_SIZE).toEqual(['sizeLabel', 'progress']);
    expect(ERROR_DETAIL_KEYS.REFILL_COUNT_REACHED).toEqual(['requested', 'progress']);
    for (const code of ['REFILL_WRONG_STEP', 'REFILL_CYLINDER_NOT_EMPTY', 'REFILL_CYLINDER_ON_OTHER_REFILL', 'REFILL_CYLINDER_NOT_ON_THIS_REFILL'] as const) {
      expect(ERROR_DETAIL_KEYS[code]).toEqual(['progress']);
    }
    expect(ERROR_DETAIL_KEYS.DAY_SHEET_WRONG_DATE).toEqual(['sheetDate', 'date']);
    expect(ERROR_DETAIL_KEYS.DAY_SHEET_ROW_ERRORS).toEqual(['rows', 'total']);
    for (const code of ['DAY_NOT_FOUND', 'DAY_LOCKED', 'DAY_SHEET_UNREADABLE', 'DAY_SHEET_OUTDATED', 'DAY_VERSION_CHANGED', 'RECONCILIATION_RETIRED'] as const) {
      expect({ code, keys: ERROR_DETAIL_KEYS[code] }).toEqual({ code, keys: undefined });
    }
  });
});
