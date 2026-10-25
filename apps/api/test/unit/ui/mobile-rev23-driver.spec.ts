/**
 * REVIEW23 ux-02, ux-03 and ux-04: the driver app.
 *
 * - ux-02: a refill the office assigns was invisible on Today, which said "Nothing to do.". Today now
 *   lists the driver's open refills (the Refills list's query), each opening the refill; the footer stays
 *   the trip's (rule 1); "Nothing to do." shows only with no trip and no refill; the menu's Refills row
 *   shows the count.
 * - ux-03: on a 360×640 phone the take-back strip ("AG-C0031 · Full", which catches a wrong state tap)
 *   fell under the footer. It now sits right under the state tap, above the count and a shorter camera.
 * - ux-04: "Bring back unfilled" had no way back and sat just under "Type number". It now sits under the
 *   title, "Back to filling" undoes it (no server call, no confirm) while the station step is still open
 *   and nothing came back, and the lists show the run's own step ("Bring them back").
 *
 * The phone has no UI test runner: the refill rules run as plain logic (refillModel.ts with its native
 * modules stubbed), the camera rule likewise, and the screens are read as syntax trees. The layout itself
 * was measured in the preview at 360×640 and font 1.3 (the fix's report).
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
const { cameraHeightFor } = require(path.join(MOBILE_SRC, 'ui', 'scan', 'cameraHeight.ts')) as typeof import('../../../../mobile/src/ui/scan/cameraHeight');
const { driver } = require(path.join(MOBILE_SRC, 'i18n', 'en', 'driver.ts')) as typeof import('../../../../mobile/src/i18n/en/driver');
/* eslint-enable @typescript-eslint/no-var-requires */

type DriverRefill = import('../../../../mobile/src/screens/driver/refillModel').DriverRefill;

function refill(over: Partial<DriverRefill> & Pick<DriverRefill, 'id' | 'status'>): DriverRefill {
  return { requestedCount: 1, counts: { requested: 1, picked: 1, filled: 0, received: 0 }, createdAt: '2026-10-25T05:00:00.000Z', ...over };
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

function attributeValue(element: JsxTag, name: string): ts.Expression | undefined {
  const property = element.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name,
  );
  const init = property?.initializer;
  if (!init) return undefined;
  if (ts.isStringLiteral(init)) return init;
  return ts.isJsxExpression(init) ? init.expression : undefined;
}

describe('REV23 ux-02 A refill the office assigns shows on Today', () => {
  it('REV23 ux-02 Today reads the driver\'s refills and lists the open ones, oldest first', () => {
    const list = [
      refill({ id: 'done', status: 'COMPLETED', createdAt: '2026-10-25T03:00:00.000Z' }),
      refill({ id: 'later', status: 'ASSIGNED', createdAt: '2026-10-25T06:00:00.000Z' }),
      refill({ id: 'first', status: 'EMPTIES_PICKED', createdAt: '2026-10-25T04:00:00.000Z' }),
      refill({ id: 'gone', status: 'CANCELLED', createdAt: '2026-10-25T02:00:00.000Z' }),
    ];
    expect(model.openRefillsOf(list).map((r) => r.id)).toEqual(['first', 'later']);

    const today = fs.readFileSync(path.join(DRIVER, 'TodayScreen.tsx'), 'utf8');
    expect(today).toMatch(/queryKey: REFILLS_QUERY_KEY,\s*queryFn: fetchDriverRefills/);
    expect(today).toMatch(/openRefillsOf\(refills\.data\)/);
    expect(today).toMatch(/navigation\.navigate\('RefillRun', \{ refillId: refill\.id \}\)/);
  });

  it('REV23 ux-02 "Nothing to do." shows only with no trip and no open refill, and never before the refills are known', () => {
    const source = parse('screens/driver/TodayScreen.tsx');
    const empty = jsx(source, 'EmptyState').filter((e) => attributeValue(e, 'title')?.getText() === "t('driver.home.empty.title')");
    expect(empty).toHaveLength(1);
    // Walk up: the EmptyState is the else-branch of `current || openRefills.length > 0`, guarded by `refillsKnown`.
    const conditions: string[] = [];
    let node: ts.Node | undefined = empty[0];
    while (node) {
      if (ts.isConditionalExpression(node)) conditions.push(node.condition.getText());
      node = node.parent;
    }
    expect(conditions).toContain('refillsKnown');
    expect(conditions).toContain('current || openRefills.length > 0');
    expect(driver.home.empty.body).toBe('New trips and refills appear by themselves.');
  });

  it('REV23 ux-02 the footer stays the trip\'s: refill rows open the refill and add no button', () => {
    const source = parse('screens/driver/TodayScreen.tsx');
    const rows = jsx(source, 'RefillRow');
    expect(rows).toHaveLength(1);
    expect(attributeValue(rows[0], 'onPress')?.getText()).toContain("navigate('RefillRun'");
    // The one footer button is still the trip's "Start trip" / "Continue trip", shown only with a trip.
    const footerButtons = jsx(source, 'Button').filter((b) => attributeValue(b, 'testID')?.getText() === '"home.go"');
    expect(footerButtons).toHaveLength(1);
  });

  it('REV23 ux-02 a refill row keeps its chip under the line (never beside it), like the trip rows', () => {
    const source = parse('screens/driver/RefillsScreen.tsx');
    const rows = jsx(source, 'ListRow');
    expect(rows).toHaveLength(1);
    expect(rows[0].attributes.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText() === 'trailing')).toBe(false);
    expect(attributeValue(rows[0], 'below')?.getText()).toContain('<StageChip');
    expect(driver.home.refillRow).toBe('Refill · {{line}}');
  });

  it('REV23 ux-02 the menu\'s Refills row shows how many are open', () => {
    const menu = fs.readFileSync(path.join(MOBILE_SRC, 'navigation', 'menus', 'driverMenu.ts'), 'utf8');
    expect(menu).toMatch(/badge: openRefills > 0 \? String\(openRefills\) : undefined/);
    const side = fs.readFileSync(path.join(MOBILE_SRC, 'components', 'SideMenu.tsx'), 'utf8');
    expect(side).toMatch(/item\.badge \?/);
    expect(side).toMatch(/accessibilityLabel=\{item\.accessibilityLabel \?\? item\.label\}/);
  });
});

describe('REV23 ux-03 The take-back strip shows on a 360×640 phone, right under the state tap', () => {
  it('REV23 ux-03 take back\'s camera is shorter, so the tap, the strip, the count and the camera fit above the footer', () => {
    expect(cameraHeightFor(640)).toBe(179);
    expect(cameraHeightFor(640, true)).toBe(115);
    expect(cameraHeightFor(740, true)).toBe(133);
    expect(cameraHeightFor(400, true)).toBe(112);
    expect(cameraHeightFor(2000, true)).toBe(220);
    // The other steps keep the spec's camera.
    expect(cameraHeightFor(1200)).toBe(300);
    expect(cameraHeightFor(400)).toBe(160);
  });

  it('REV23 ux-03 with `resultFirst` the panel renders the strip and "Not saved" before the count and the camera', () => {
    const source = parse('ui/scan/ScanPanel.tsx');
    const branch = findAll(source, ts.isConditionalExpression).find((node) => node.condition.getText() === 'resultFirst');
    expect(branch).toBeDefined();
    const order = (text: string) => ['{strip}', '{unsaved}', '{beforeCamera}', '{camera}'].map((part) => text.indexOf(part));
    const first = order(branch!.whenTrue.getText());
    expect(first.every((at) => at >= 0)).toBe(true);
    expect([...first].sort((a, b) => a - b)).toEqual(first);
    // Every other step keeps the camera first.
    const rest = branch!.whenFalse.getText();
    expect(rest.indexOf('{camera}')).toBeLessThan(rest.indexOf('{strip}'));
    expect(fs.readFileSync(path.join(MOBILE_SRC, 'ui', 'scan', 'ScanPanel.tsx'), 'utf8')).toMatch(/cameraHeightFor\(height, resultFirst\)/);
  });

  it('REV23 ux-03 the visit\'s take-back phase uses it, with the count between the strip and the camera', () => {
    const source = parse('screens/driver/VisitScreen.tsx');
    const panels = jsx(source, 'ScanPanel').filter((p) => attributeValue(p, 'step')?.getText() === '"TAKE_BACK"');
    expect(panels).toHaveLength(1);
    const panel = panels[0];
    expect(panel.attributes.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText() === 'resultFirst')).toBe(true);
    expect(attributeValue(panel, 'beforeCamera')?.getText()).toContain('mode="soft"');
    // The StepFrame of that phase gives the count to the panel, not before it.
    let frame: ts.Node | undefined = panel;
    while (frame && !(ts.isJsxSelfClosingElement(frame) && frame.tagName.getText() === 'StepFrame')) frame = frame.parent;
    expect(frame).toBeDefined();
    const props = (frame as ts.JsxSelfClosingElement).attributes.properties.map((p) => p.name?.getText());
    expect(props).toEqual(expect.arrayContaining(['control', 'scan']));
    expect(props).not.toContain('count');
  });
});

describe('REV23 ux-04 "Bring back unfilled" can be undone and sits away from "Type number"', () => {
  afterEach(() => {
    model.backToFilling('r1');
  });

  it('REV23 ux-04 "Back to filling" undoes it while the station step is open and nothing came back', () => {
    const atStation = refill({ id: 'r1', status: 'EMPTIES_PICKED' });
    expect(model.refillStepOf(atStation, false)).toBe('FILL');
    model.bringBackUnfilled('r1');
    expect(model.refillStepOf(atStation, true)).toBe('UNLOAD');
    expect(model.canGoBackToFilling(atStation, true)).toBe(true);
    expect(model.canGoBackToFilling(refill({ id: 'r1', status: 'AT_STATION' }), true)).toBe(true);
    // Once the shop has received one, or the server is past the station, there is nothing to undo.
    expect(model.canGoBackToFilling(refill({ id: 'r1', status: 'EMPTIES_PICKED', counts: { requested: 2, picked: 2, filled: 0, received: 1 } }), true)).toBe(false);
    expect(model.canGoBackToFilling(refill({ id: 'r1', status: 'FILLED' }), true)).toBe(false);
    expect(model.canGoBackToFilling(atStation, false)).toBe(false);
    model.backToFilling('r1');
    expect(model.refillStepOf(atStation, false)).toBe('FILL');
  });

  it('REV23 ux-04 the lists show the run\'s own step: a refill brought back unfilled reads "Bring them back"', () => {
    // As the Inc 3 server sends them: `stage` with `counts`.
    const picked = refill({ id: 'r1', status: 'EMPTIES_PICKED', stage: 'PICKED_UP' });
    expect(model.driverStageOf(picked, false)).toBe('PICKED_UP');
    expect(model.driverStageOf(picked, true)).toBe('COMING_BACK');
    expect(model.driverStageOf(refill({ id: 'r1', status: 'AT_STATION', stage: 'AT_STATION' }), true)).toBe('COMING_BACK');
    // A received cylinder is the server's "Back at store" either way; other steps never change.
    const received = refill({ id: 'r1', status: 'EMPTIES_PICKED', stage: 'BACK_AT_STORE', counts: { requested: 2, picked: 2, filled: 0, received: 1 } });
    expect(model.driverStageOf(received, true)).toBe('BACK_AT_STORE');
    const assigned = refill({ id: 'r1', status: 'ASSIGNED', stage: 'DRIVER_ASSIGNED', counts: { requested: 1, picked: 0, filled: 0, received: 0 } });
    expect(model.driverStageOf(assigned, true)).toBe('DRIVER_ASSIGNED');
    // An older answer without `stage` is read from its status, the same way.
    expect(model.driverStageOf(refill({ id: 'r1', status: 'EMPTIES_PICKED' }), true)).toBe('COMING_BACK');
    expect(driver.refills.stage.COMING_BACK).toBe('Bring them back');
  });

  it('REV23 ux-04 the fill step puts "Bring back unfilled" under the title, and the unload step offers "Back to filling"', () => {
    const source = parse('screens/driver/RefillRunScreen.tsx');
    const unfilled = jsx(source, 'Button').filter((b) => attributeValue(b, 'label')?.getText() === "t('driver.refills.run.noneFilled')");
    expect(unfilled).toHaveLength(1);
    // Its slot in the StepFrame is `control` (before the count and the camera), not `rare` (after "Type number").
    let slot: ts.Node | undefined = unfilled[0];
    while (slot && !ts.isJsxAttribute(slot)) slot = slot.parent;
    expect((slot as ts.JsxAttribute).name.getText()).toBe('control');

    const back = jsx(source, 'Button').filter((b) => attributeValue(b, 'label')?.getText() === "t('driver.refills.run.backToFill')");
    expect(back).toHaveLength(1);
    expect(attributeValue(back[0], 'onPress')?.getText()).toBe('() => backToFilling(view.id)');
    let guard: ts.Node | undefined = back[0];
    while (guard && !ts.isConditionalExpression(guard)) guard = guard.parent;
    expect((guard as ts.ConditionalExpression).condition.getText()).toBe('canGoBackToFilling(view, unfilled)');
    // No confirm: rule 7's list is closed, and the undo makes it safe.
    expect(fs.readFileSync(path.join(DRIVER, 'RefillRunScreen.tsx'), 'utf8')).not.toMatch(/confirm\(/);
    expect(driver.refills.run.backToFill).toBe('Back to filling');
  });
});
