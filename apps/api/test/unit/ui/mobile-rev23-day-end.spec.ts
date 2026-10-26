/**
 * REVIEW23 ux-01 (with its duplicate robustness-jobs-04) and ux-07: the shop app's Day-end.
 *
 * ux-01: the office reviews a sheet the next morning, after the 3 am cut-off, and sends it back (or
 * reopens an approved day). Day-end only ever opened "today", so the note, the red card and "Upload filled
 * sheet" for that day never showed, and the day stayed Open on the website for good. A sheet downloaded
 * just before 3 am was lost the same way. Now Home and S19 read `GET /day-end` and open the day that waits
 * for the shop (dayEndModel.dayEndTarget): a day sent back or reopened first, then an earlier day never
 * sent, else today; the route carries that date through Check and send and back.
 *
 * ux-07: "Download again" made a new sheet without a word, and only the newest sheet can be uploaded, so
 * the filled copy (and an upload made from it) became unusable. The link now always comes with the one
 * line "Your filled sheet can't be sent after this." (rule 2; no confirm, rule 7's list is closed).
 *
 * The phone has no UI test runner: the rule runs as plain logic (dayEndModel.ts imports only
 * shared-types), the screens are read as syntax trees, and the shots are in the fix's report.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { DayEndDayDto, DayEndListItem } from '@smartfleet/shared-types';

const MOBILE_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'mobile', 'src');
const DAYEND = path.join(MOBILE_SRC, 'screens', 'distributor', 'dayend');

/* eslint-disable @typescript-eslint/no-var-requires */
const { dayEndTarget, dayEndView, isBusyRefusal } = require(path.join(DAYEND, 'dayEndModel.ts')) as typeof import('../../../../mobile/src/screens/distributor/dayend/dayEndModel');
const { home } = require(path.join(MOBILE_SRC, 'i18n', 'en', 'home.ts')) as typeof import('../../../../mobile/src/i18n/en/home');
const { dayEnd } = require(path.join(MOBILE_SRC, 'i18n', 'en', 'dayEnd.ts')) as typeof import('../../../../mobile/src/i18n/en/dayEnd');
/* eslint-enable @typescript-eslint/no-var-requires */

const TODAY = '2026-10-25';
const YESTERDAY = '2026-10-24';

function day(businessDate: string, status: DayEndListItem['status'], stage: DayEndListItem['stage']): DayEndListItem {
  return { businessDate, status, stage, submittedAt: null, approvedAt: null, differences: 0 };
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function findAll<T extends ts.Node>(root: ts.Node, test: (node: ts.Node) => node is T): T[] {
  const out: T[] = [];
  const visit = (node: ts.Node): void => {
    if (test(node)) out.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return out;
}

const words = (text: string) => text.replace(/\{\{\w+\}\}/g, '').split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;

describe('REV23 ux-01 Day-end opens the day that waits for the shop, not only today', () => {
  it('REV23 ux-01 a day the office sent back after the cut-off is the one Home names and S19 opens (the review\'s case)', () => {
    // GET /day-end in the review: [{ 2026-10-24, OPEN, SENT_BACK }]; today (25 Oct) has no row.
    expect(dayEndTarget([day(YESTERDAY, 'OPEN', 'SENT_BACK')], TODAY)).toEqual({ date: YESTERDAY, due: 'SENT_BACK', stage: 'SENT_BACK' });
  });

  it('REV23 ux-01 a reopened day reads SENT_BACK too, and the oldest one that waits comes first', () => {
    const days = [day(TODAY, 'OPEN', 'NOT_STARTED'), day(YESTERDAY, 'OPEN', 'SENT_BACK'), day('2026-10-20', 'OPEN', 'SENT_BACK')];
    expect(dayEndTarget(days, TODAY)).toMatchObject({ date: '2026-10-20', due: 'SENT_BACK' });
  });

  it('REV23 ux-01 the office\'s send-back comes before an earlier day that was only never sent', () => {
    const days = [day(YESTERDAY, 'OPEN', 'SENT_BACK'), day('2026-10-22', 'OPEN', 'READY')];
    expect(dayEndTarget(days, TODAY)).toMatchObject({ date: YESTERDAY, due: 'SENT_BACK' });
  });

  it('REV23 robustness-jobs-04 an earlier day uploaded but not sent, or with a sheet and nothing sent, is still reachable', () => {
    expect(dayEndTarget([day(TODAY, 'OPEN', 'NOT_STARTED'), day(YESTERDAY, 'OPEN', 'READY')], TODAY)).toEqual({
      date: YESTERDAY,
      due: 'READY',
      stage: 'READY',
    });
    // A row exists only once a sheet was made: an OPEN NOT_STARTED earlier day is a sheet downloaded before 3 am.
    expect(dayEndTarget([day(YESTERDAY, 'OPEN', 'NOT_STARTED')], TODAY)).toEqual({ date: YESTERDAY, due: 'NOT_SENT', stage: 'NOT_STARTED' });
  });

  it('REV23 ux-01 days with the office or approved never wait for the shop: then today, with its own stage', () => {
    const days = [day(TODAY, 'SUBMITTED', 'WAITING_FOR_APPROVAL'), day(YESTERDAY, 'APPROVED', 'APPROVED'), day('2026-10-23', 'SUBMITTED', 'WAITING_FOR_APPROVAL')];
    expect(dayEndTarget(days, TODAY)).toEqual({ date: TODAY, due: null, stage: 'WAITING_FOR_APPROVAL' });
    expect(dayEndTarget([], TODAY)).toEqual({ date: TODAY, due: null, stage: 'NOT_STARTED' });
    // Today sent back the same evening is due too.
    expect(dayEndTarget([day(TODAY, 'OPEN', 'SENT_BACK')], TODAY)).toEqual({ date: TODAY, due: 'SENT_BACK', stage: 'SENT_BACK' });
  });

  it('REV23 ux-01 the shop\'s route takes an optional date; Home, Check and send and "Today\'s sheet" pass one', () => {
    const stack = fs.readFileSync(path.join(MOBILE_SRC, 'navigation', 'DistributorStack.tsx'), 'utf8');
    expect(stack).toMatch(/DayEnd: \{ date\?: string \} \| undefined;/);

    const homeScreen = fs.readFileSync(path.join(MOBILE_SRC, 'screens', 'distributor', 'HomeScreen.tsx'), 'utf8');
    expect(homeScreen).toMatch(/navigation\.navigate\('DayEnd', \{ date: dayEnd\.target\.date \}\)/);
    expect(homeScreen).toMatch(/useDayEndDue\(/);

    const preview = fs.readFileSync(path.join(DAYEND, 'DayEndPreviewScreen.tsx'), 'utf8');
    expect(preview).toMatch(/navigation\.navigate\('DayEnd', \{ date \}\)/);
    expect(preview).not.toMatch(/navigate\('DayEnd'\)/);

    const screen = fs.readFileSync(path.join(DAYEND, 'DayEndScreen.tsx'), 'utf8');
    expect(screen).toMatch(/useShopRoute<'DayEnd'>\(\)/);
    expect(screen).toMatch(/params\?\.date/);
    // The shown day is the route's, else the one that waits: never businessDate(now) alone, which turns over at 3 am.
    expect(screen).not.toMatch(/const date = businessDate\(/);
    expect(screen).toMatch(/navigation\.replace\('DayEnd', \{ date: due\.today \}\)/);

    // GET /day-end is the shop's list (API_CONTRACT §10.2), read by the shared hook.
    const api = fs.readFileSync(path.join(MOBILE_SRC, 'screens', 'distributor', 'shared', 'api.ts'), 'utf8');
    expect(api).toMatch(/api\.get<Page<DayEndListItem>>\('\/day-end'\)/);
    const hook = fs.readFileSync(path.join(DAYEND, 'useDayEndDue.ts'), 'utf8');
    expect(hook).toMatch(/dayEndTarget\(/);
  });

  it('REV23 ux-01 an upload, a send or a new sheet refreshes the list, so Home moves on to the next day', () => {
    const files = fs.readFileSync(path.join(DAYEND, 'useSheetFiles.tsx'), 'utf8');
    expect(files.match(/invalidateQueries\(\{ queryKey: qk\.dayEndList \}\)/g)?.length).toBe(2);
    const send = fs.readFileSync(path.join(DAYEND, 'SendDaySheet.tsx'), 'utf8');
    expect(send.match(/invalidateQueries\(\{ queryKey: qk\.dayEndList \}\)/g)?.length).toBe(2);
  });

  it('REV23 ux-01 Home\'s row names the day within the word budget, in plain words', () => {
    for (const line of Object.values(home.tiles.dayEndDue)) {
      expect(line).toContain('{{date}}');
      expect(words(line)).toBeLessThanOrEqual(4);
    }
    expect(dayEnd.btn.today.split(/\s+/).length).toBeLessThanOrEqual(3);
  });
});

describe('REV23 ux-07 "Download again" says that the filled sheet can\'t be sent after it', () => {
  const sentBack: DayEndDayDto = {
    businessDate: YESTERDAY,
    status: 'OPEN',
    stage: 'SENT_BACK',
    cutoffAt: '2026-10-24T22:00:00.000Z',
    summary: { inStore: { total: 0, bySize: [] }, onVans: 0, withCustomers: 0, deliveredToday: 0, takenBackToday: 0, receivedToday: 0 },
    lastUpload: { uploadedAt: '2026-10-24T15:00:00.000Z', version: 1, differences: 1 },
    officeNote: { kind: 'SENT_BACK', text: 'AG-C0005 looked fine at 6 pm. Check it again.', at: '2026-10-25T05:00:00.000Z' },
    allowedActions: ['DOWNLOAD', 'UPLOAD'],
  };

  it('REV23 ux-07 on the sent-back day the link is still there (a lost file is never a dead end) and the footer is the upload', () => {
    const view = dayEndView(sentBack);
    expect(view.downloadAgain).toBe(true);
    expect(view.footer).toBe('upload');
    expect(view.note).toEqual(sentBack.officeNote);
  });

  it('REV23 ux-07 S19 renders the one helper line with "Download again", wherever the link shows', () => {
    const source = parse(path.join(DAYEND, 'DayEndScreen.tsx'));
    const conditionals = findAll(source, ts.isConditionalExpression).filter((node) => node.condition.getText() === 'parts.downloadAgain');
    expect(conditionals).toHaveLength(1);
    const branch = conditionals[0].whenTrue.getText();
    expect(branch).toContain("t('dayEnd.btn.downloadAgain')");
    expect(branch).toContain("t('dayEnd.btn.downloadAgainHelp')");
    expect(branch.indexOf("t('dayEnd.btn.downloadAgain')")).toBeLessThan(branch.indexOf("t('dayEnd.btn.downloadAgainHelp')"));
  });

  it('REV23 ux-07 the line is one short helper (rule 2: 8 words at most), and it asks nothing (rule 7)', () => {
    expect(dayEnd.btn.downloadAgainHelp).toBe("Your filled sheet can't be sent after this.");
    expect(words(dayEnd.btn.downloadAgainHelp)).toBeLessThanOrEqual(8);
    const files = fs.readFileSync(path.join(DAYEND, 'useSheetFiles.tsx'), 'utf8');
    expect(files).not.toMatch(/confirm\(/);
  });
});

describe('REV23 security-02 a day-end upload the busy server turns away offers "Try again"', () => {
  // The server reads one sheet at a time and turns one away while two wait: 503 SERVICE_UNAVAILABLE,
  // "The service is busy. Please try again in a minute." (API_CONTRACT §10.5). The same file can just be
  // sent again. A 429 says how many minutes to wait, so it offers no button (the upload button stays).
  it('REV23 security-02 only the busy answer counts as busy', () => {
    expect(isBusyRefusal({ code: 'SERVICE_UNAVAILABLE' })).toBe(true);
    for (const other of [{ code: 'RATE_LIMITED' }, { code: 'DAY_SHEET_UNREADABLE' }, { code: 'NETWORK_OFFLINE' }, null, undefined, 'SERVICE_UNAVAILABLE']) {
      expect(isBusyRefusal(other)).toBe(false);
    }
  });

  it.each(['DayEndScreen.tsx', 'DayEndPreviewScreen.tsx'])('REV23 security-02 %s gives the busy upload error "Try again" with the same file', (file) => {
    const source = parse(path.join(DAYEND, file));
    const banners = findAll(source, (node): node is ts.JsxSelfClosingElement => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'ErrorBanner');
    const retries = banners
      .flatMap((banner) => banner.attributes.properties.filter((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === 'onRetry'))
      .map((attribute) => attribute.initializer?.getText() ?? '');
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatch(/isBusyRefusal\((upload|again)\.error\)/);
    expect(retries[0]).toMatch(/(upload|again)\.retry \? (upload|again)\.retry : undefined/);
  });
});
