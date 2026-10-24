/**
 * Review fixes on the office website's wallet page (UX_ADMIN §2.6, API_CONTRACT §7.8). The website has
 * no UI test runner, so its rules run here on their own:
 * - what the integrity line says, from the API's `integrity` block (money-data-02);
 * - which dates the history presets send, counted from the business date (money-data-07).
 * The browser checks (before/after screenshots, the correction recorded on a wallet below zero, the
 * "Today" preset at 01:30 with the browser clock moved) are in the review's fix-web folder.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const ADMIN_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'admin-web', 'src');

/* eslint-disable @typescript-eslint/no-var-requires */
const { integrityState } = require(path.join(ADMIN_SRC, 'features', 'wallets', 'integrity.ts')) as typeof import('../../../../admin-web/src/features/wallets/integrity');
const { HISTORY_PRESETS, historyToday, rangeFromSearch } = require(path.join(ADMIN_SRC, 'features', 'wallets', 'historyDates.ts')) as typeof import('../../../../admin-web/src/features/wallets/historyDates');
const { presetRange, presetRangeFrom } = require(path.join(ADMIN_SRC, 'ui', 'dateRange.ts')) as typeof import('../../../../admin-web/src/ui/dateRange');
/* eslint-enable @typescript-eslint/no-var-requires */

const DAY = { timezone: 'Asia/Karachi', cutoffLocalTime: '03:00' };
const CHECKED_AT = '2026-10-23T19:30:00.000Z';

function detail(balancePaisa: string, ok: boolean, ledgerSumPaisa: string, differencePaisa: string) {
  return { balancePaisa, integrity: { ok, ledgerSumPaisa, differencePaisa, checkedAt: CHECKED_AT } };
}

function parse(relative: string): ts.SourceFile {
  const file = path.join(ADMIN_SRC, relative);
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

describe('REV money-data-02 a wallet below zero whose history matches is not a history mismatch', () => {
  it('REV money-data-02 the API answer of the review (balance −Rs 300, history −Rs 300) reads as below zero, not "doesn\'t match by Rs 0"', () => {
    // The Inc 1 review's API answer (negative-legacy-balance.e2e-spec.ts N1, retired at Inc 2 once inc1b
    // refused balances below zero): {ok:false, ledgerSumPaisa:'-30000', differencePaisa:'0'}.
    expect(integrityState(detail('-30000', false, '-30000', '0'))).toBe('belowZero');
  });

  it('REV money-data-02 a real history mismatch still reads as a mismatch, below zero or not', () => {
    expect(integrityState(detail('182000', false, '170000', '12000'))).toBe('mismatch');
    expect(integrityState(detail('-30000', false, '-29500', '-500'))).toBe('mismatch');
  });

  it('REV money-data-02 ok is ok, and an unexplained "not ok" stays on the safe side (a mismatch)', () => {
    expect(integrityState(detail('422000', true, '422000', '0'))).toBe('ok');
    expect(integrityState(detail('0', false, '0', '0'))).toBe('mismatch');
    expect(integrityState(detail('-30000', false, '-30000', 'not-a-number'))).toBe('mismatch');
  });

  it('REV money-data-02 the page disables "Record correction" only for a mismatch, and says what to do below zero', () => {
    const page = parse('features/wallets/WalletPage.tsx');
    const text = page.getFullText();
    // The button's `disabled` and its reason come from the mismatch state, never from `integrity.ok` alone.
    const mismatch = findAll(page, ts.isVariableDeclaration).find((node) => node.name.getText() === 'mismatch');
    expect(mismatch?.initializer?.getText()).toMatch(/integrityState\(.*\)\s*===\s*'mismatch'/);
    const buttons = findAll(page, ts.isJsxElement).filter(
      (node) => node.openingElement.tagName.getText() === 'Button' && node.children.some((child) => child.getText().includes("t('page.recordCorrection')")),
    );
    expect(buttons).toHaveLength(1);
    const attr = (name: string) =>
      buttons[0].openingElement.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name)?.initializer?.getText() ?? '';
    expect(attr('disabled')).toMatch(/\bmismatch\b/);
    expect(attr('disabled')).not.toMatch(/integrity\.ok|integrityOk/);
    expect(attr('disabledReason')).toMatch(/\bmismatch\b/);
    // Below zero has its own words (a warning, not the "Tell engineering" banner).
    expect(text).toMatch(/state === 'belowZero'[\s\S]*?t\('integrity\.belowZero'\)/);
    const copy = fs.readFileSync(path.join(ADMIN_SRC, 'i18n', 'en', 'wallets.ts'), 'utf8');
    expect(copy).toContain("belowZero: 'Balance is below zero. Record a correction to bring it to Rs 0.'");
  });
});

describe('REV money-data-07 the wallet history presets count from the business date', () => {
  // 01:30 Karachi on Sat 24 Oct 2026: the business day (03:00 cut-off, ADR-21) is still Fri 23 Oct.
  const at0130 = Date.parse('2026-10-23T20:30:00.000Z');

  it('REV money-data-07 at 01:30 "Today" asks for the business day that holds a correction recorded at 00:30', () => {
    const today = historyToday(DAY, at0130);
    expect(today).toBe('2026-10-23');
    expect(presetRangeFrom('today', today)).toEqual({ preset: 'today', from: '2026-10-23', to: '2026-10-23' });
    // The URL the preset writes reads back as Today, not Custom.
    expect(rangeFromSearch({ from: '2026-10-23', to: '2026-10-23' }, false, today)).toEqual({ preset: 'today', from: '2026-10-23', to: '2026-10-23' });
  });

  it('REV money-data-07 all four presets follow the business date, including This month between 00:00 and 03:00 on the 1st', () => {
    // 01:30 Karachi on Sun 1 Nov 2026 is still business day Sat 31 Oct.
    const first = historyToday(DAY, Date.parse('2026-10-31T20:30:00.000Z'));
    expect(first).toBe('2026-10-31');
    expect(HISTORY_PRESETS.map((preset) => presetRangeFrom(preset, first))).toEqual([
      { preset: 'today', from: '2026-10-31', to: '2026-10-31' },
      { preset: 'last7', from: '2026-10-25', to: '2026-10-31' },
      { preset: 'thisMonth', from: '2026-10-01', to: '2026-10-31' },
      { preset: 'lastMonth', from: '2026-09-01', to: '2026-09-30' },
    ]);
    // No dates in the URL is This month, counted from the same business date.
    expect(rangeFromSearch({}, false, first)).toEqual({ preset: 'thisMonth', from: '2026-10-01', to: '2026-10-31' });
  });

  it('REV money-data-07 the cut-off comes from the settings (`day`), and after 03:00 the business date is the calendar date', () => {
    expect(historyToday({ timezone: 'Asia/Karachi', cutoffLocalTime: '00:00' }, at0130)).toBe('2026-10-24');
    expect(historyToday(DAY, Date.parse('2026-10-23T22:30:00.000Z'))).toBe('2026-10-24'); // 03:30 on the 24th
  });

  it('REV money-data-07 other pages keep calendar dates (expenses, §7.12): the generic preset is unchanged', () => {
    expect(presetRange('today', at0130)).toEqual({ preset: 'today', from: '2026-10-24', to: '2026-10-24' });
  });

  it('REV money-data-07 the wallet page counts its presets from the business date, and so does the preset picker', () => {
    const page = parse('features/wallets/WalletPage.tsx');
    const today = findAll(page, ts.isVariableDeclaration).find((node) => node.name.getText() === 'today');
    expect(today?.initializer?.getText()).toMatch(/^historyToday\(config\.day\)$/);
    const range = findAll(page, ts.isVariableDeclaration).find((node) => node.name.getText() === 'range');
    expect(range?.initializer?.getText()).toMatch(/^rangeFromSearch\(search, customDates, today\)$/);
    const filters = findAll(page, ts.isJsxSelfClosingElement).filter((node) => node.tagName.getText() === 'DateRangeFilter');
    expect(filters).toHaveLength(1);
    const todayAttr = filters[0].attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === 'today');
    expect(todayAttr?.initializer?.getText()).toBe('{today}');
    // DateRangeFilter turns a picked preset into dates from that `today` when it is given.
    const filterBar = parse('ui/FilterBar.tsx').getFullText();
    expect(filterBar).toMatch(/today \? presetRangeFrom\(preset, today\) : presetRange\(preset\)/);
  });
});
