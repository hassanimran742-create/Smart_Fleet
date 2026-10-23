/**
 * The Expenses page of the office website (UX_ADMIN §2.7), checked without a browser:
 * - the static UI rules of test/helpers/ui-rules.ts (UXQ-011): no literal on-screen text, no native
 *   dialogs, no stray hex colours, no "Rs." and no "On hold", and no raw enum values in its copy;
 * - every counted string has its `_one` and `_other` forms (G16-04), the fuel-log card included;
 * - the legacy ExpensesScreen and FuelReportScreen are gone (UX_ADMIN §2.7 "Removed").
 */
import * as fs from 'fs';
import * as path from 'path';
import { APPS_DIR, describeHits, listSources, scanFile } from '../helpers/ui-rules';
import { expenses } from '../../../admin-web/src/i18n/en/expenses';

const ADMIN_SRC = path.join(APPS_DIR, 'admin-web', 'src');
const FEATURE = path.join(ADMIN_SRC, 'features', 'expenses');

/** Every key path of a nested copy object. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([key, inner]) => keyPaths(inner, prefix ? `${prefix}.${key}` : key));
}

describe('expenses website', () => {
  it('the Expenses page passes the static UI scan (UXQ-011 rules)', () => {
    const files = listSources(FEATURE);
    expect(files.map((file) => path.basename(file)).sort()).toEqual(
      expect.arrayContaining(['ExpensesPage.tsx', 'ExpenseDrawer.tsx', 'ExpenseTypesDrawer.tsx', 'ExpenseTotals.tsx', 'FuelLogsTab.tsx']),
    );
    expect(describeHits(files.flatMap((file) => scanFile(file, { jsx: file.endsWith('.tsx') })))).toEqual([]);
    expect(describeHits(scanFile(path.join(ADMIN_SRC, 'i18n', 'en', 'expenses.ts'), { copy: true }))).toEqual([]);
  });

  it('G16-04 every counted string of the expenses copy has a singular and a plural form', () => {
    const keys = keyPaths(expenses);
    const counted = keys.filter((key) => /_(one|other)$/.test(key));
    expect(counted).toEqual(expect.arrayContaining(['totals.fuelCardCount_one', 'totals.fuelCardCount_other']));
    for (const key of counted) {
      const base = key.replace(/_(one|other)$/, '');
      expect(keys).toContain(`${base}_one`);
      expect(keys).toContain(`${base}_other`);
    }
    // A string that shows {{count}} is always one of a pair.
    for (const key of keys) {
      const text = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], expenses);
      if (typeof text === 'string' && text.includes('{{count}}')) expect(key).toMatch(/_(one|other)$/);
    }
    const t = expenses.totals;
    expect([t.fuelCardSummary_one, t.fuelCardSummary_other]).toEqual([
      'Petrol · driver fuel logs {{amount}} ({{count}} log)',
      'Petrol · driver fuel logs {{amount}} ({{count}} logs)',
    ]);
  });

  it('the legacy expenses and fuel report screens are deleted', () => {
    for (const name of ['ExpensesScreen.tsx', 'FuelReportScreen.tsx']) {
      expect(fs.existsSync(path.join(ADMIN_SRC, 'legacy', name))).toBe(false);
    }
  });
});
