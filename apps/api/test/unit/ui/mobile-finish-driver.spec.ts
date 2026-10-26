/**
 * DRV-060: the driver's Today sums up the assigned refills in one line (UX_MOBILE §7.2 R2), a follow-up of
 * review23 ux-02 (DRV-059). With trips on Today, the refill rows come after them and can fall below the fold
 * of a 360×640 phone; the line under the van says at once that refills wait: "2 refills · 7 cylinders".
 *
 * The phone has no UI test runner: the summary runs as plain logic (refillModel.ts with its native modules
 * stubbed), the words from the English copy, and Today is read as a syntax tree.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android ?? options.default },
  I18nManager: { isRTL: false },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '0.1.0', extra: { variant: 'driver', apiBaseUrl: 'http://test.local/api/v1' } } },
}));
jest.mock('expo-updates', () => ({ updateId: null, isEnabled: false }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

const MOBILE_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'mobile', 'src');
const DRIVER = path.join(MOBILE_SRC, 'screens', 'driver');

/* eslint-disable @typescript-eslint/no-var-requires */
const model = require(path.join(DRIVER, 'refillModel.ts')) as typeof import('../../../../mobile/src/screens/driver/refillModel');
const { driver } = require(path.join(MOBILE_SRC, 'i18n', 'en', 'driver.ts')) as typeof import('../../../../mobile/src/i18n/en/driver');
/* eslint-enable @typescript-eslint/no-var-requires */

type DriverRefill = import('../../../../mobile/src/screens/driver/refillModel').DriverRefill;

function refill(id: string, status: DriverRefill['status'], requested: number): DriverRefill {
  return { id, status, requestedCount: requested, counts: { requested, picked: 0, filled: 0, received: 0 }, createdAt: '2026-10-25T05:00:00.000Z' };
}

/** i18next v3 plurals: `key` for a count of 1, `key_plural` for any other count. */
function words(count: number, one: string, other: string, values: Record<string, unknown>): string {
  return (count === 1 ? one : other).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name]));
}

/** Today's line for these refills, as the screen builds it. */
function line(list: DriverRefill[]): string | null {
  const summary = model.refillSummaryOf(list);
  if (!summary) return null;
  const cylinders = words(summary.cylinders, driver.trip.cylinders, driver.trip.cylinders_plural, { count: summary.cylinders });
  return words(summary.refills, driver.home.refillSummary, driver.home.refillSummary_plural, { count: summary.refills, cylinders });
}

function parse(relative: string): ts.SourceFile {
  const file = path.join(MOBILE_SRC, relative);
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

type JsxTag = ts.JsxSelfClosingElement | ts.JsxOpeningElement;

function jsx(root: ts.Node, tag: string): JsxTag[] {
  const isTag = (node: ts.Node): node is JsxTag => ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node);
  return findAll(root, isTag).filter((node) => node.tagName.getText() === tag);
}

describe('DRV-060 Today sums up the assigned refills in one line', () => {
  it('DRV-060 the line counts the open refills and their cylinders, and shows only while one is open', () => {
    expect(line([])).toBeNull();
    expect(line([refill('done', 'COMPLETED', 2), refill('gone', 'CANCELLED', 3)])).toBeNull();
    expect(line([refill('a', 'ASSIGNED', 1)])).toBe('1 refill · 1 cylinder');
    const list = [refill('a', 'ASSIGNED', 2), refill('b', 'AT_STATION', 5), refill('done', 'COMPLETED', 4), refill('gone', 'CANCELLED', 6)];
    expect(model.refillSummaryOf(list)).toEqual({ refills: 2, cylinders: 7 });
    expect(line(list)).toBe('2 refills · 7 cylinders');
    // A refill on its way back still counts (the driver hasn't finished it); one from an older server is read the same.
    expect(line([refill('c', 'FILLED', 3), { id: 'old', status: 'EMPTIES_PICKED', requestedCount: 4 }])).toBe('2 refills · 7 cylinders');
  });

  it('DRV-060 the line sits right under the van row, above the trips and refill rows, with the cylinder icon and no button', () => {
    const source = parse('screens/driver/TodayScreen.tsx');
    const summaries = jsx(source, 'RefillSummaryLine');
    expect(summaries).toHaveLength(1);
    // Rendered only with a summary, i.e. while a refill is open.
    const guard = summaries[0].parent;
    expect(ts.isConditionalExpression(guard) && guard.condition.getText()).toBe('refillSummary');
    expect(source.getFullText()).toMatch(/const refillSummary = refills\.data \? refillSummaryOf\(refills\.data\) : null;/);
    // Its place: the child right after VanRow in Today's stack.
    const stack = (jsx(source, 'VanRow')[0].parent as ts.JsxElement).children.filter((c) => !ts.isJsxText(c)).map((c) => c.getText());
    expect(stack[0]).toMatch(/^<VanRow /);
    expect(stack[1]).toBe('{refillSummary ? <RefillSummaryLine summary={refillSummary} /> : null}');
    expect(stack[2]).toMatch(/^\{current \|\| openRefills\.length > 0 \?/);
    // The line: the cylinder icon and the words; nothing to press (each refill's own row opens it).
    const fn = findAll(source, ts.isFunctionDeclaration).find((f) => f.name?.getText() === 'RefillSummaryLine');
    expect(fn).toBeDefined();
    const body = fn!.getText();
    expect(body).toMatch(/<Icon name="cylinder" size=\{24\} tone="secondary" \/>/);
    expect(body).toMatch(/t\('driver\.home\.refillSummary', \{ count: summary\.refills, cylinders \}\)/);
    expect(body).not.toMatch(/onPress|Pressable|<Button/);
    expect(body).toMatch(/testID="home\.refillSummary"/);
    // The footer stays the trip's one button (rule 1).
    expect(jsx(source, 'Button').filter((b) => b.getText().includes('testID="home.go"'))).toHaveLength(1);
  });

  it('DRV-060 the words are 2 fixed words in the theme\'s tokens, inside the driver screen\'s budget', () => {
    expect(driver.home.refillSummary).toBe('{{count}} refill · {{cylinders}}');
    expect(driver.home.refillSummary_plural).toBe('{{count}} refills · {{cylinders}}');
    expect(driver.trip.cylinders_plural).toBe('{{count}} cylinders');
    // Fixed words only (UX_PRINCIPLES §6: data is not counted): "refills" and "cylinders".
    const fixed = (template: string) => template.replace(/\{\{\w+\}\}/g, '').split(/[\s·]+/).filter(Boolean);
    expect([...fixed(driver.home.refillSummary_plural), ...fixed(driver.trip.cylinders_plural)]).toEqual(['refills', 'cylinders']);
    // No colour literal: the line's style uses the spacing tokens only.
    const today = fs.readFileSync(path.join(DRIVER, 'TodayScreen.tsx'), 'utf8');
    const style = /summary: \{([^}]*)\}/.exec(today)?.[1] ?? '';
    expect(style).toMatch(/gap: space\.sm/);
    expect(style).not.toMatch(/#[0-9a-f]{3,6}|rgb|colors\./i);
  });
});
