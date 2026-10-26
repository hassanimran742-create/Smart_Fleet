/**
 * Review fixes on the shop and driver apps' behaviour (UX_MOBILE §2.2 #16, S6, S10, S11). The phone has
 * no UI test runner, so the rules run here on their own:
 * - the form guard's rule against the real stack router (@react-navigation/routers, as the app uses);
 * - QueryBoundary itself, compiled from its .tsx with its imports stubbed, and its output compared the
 *   way React matches children (type, key and position), to see whether the data would be remounted;
 * - the "Active (n)" rule of My orders.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as React from 'react';
import * as ts from 'typescript';
import {
  CommonActions,
  StackActions,
  StackRouter,
  type ParamListBase,
  type StackNavigationState,
} from '@react-navigation/routers';

type StackState = StackNavigationState<ParamListBase>;

const MOBILE_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'mobile', 'src');

/* eslint-disable @typescript-eslint/no-var-requires */
const { isLeavingByHand, LEAVING_ACTIONS } = require(path.join(MOBILE_SRC, 'screens', 'distributor', 'shared', 'leaving.ts')) as typeof import('../../../../mobile/src/screens/distributor/shared/leaving');
const { activeTabCount } = require(path.join(MOBILE_SRC, 'screens', 'distributor', 'shared', 'format.ts')) as typeof import('../../../../mobile/src/screens/distributor/shared/format');
/* eslint-enable @typescript-eslint/no-var-requires */

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

function attributeExpression(element: JsxTag, name: string): ts.Expression | undefined {
  const property = element.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name,
  );
  const init = property?.initializer;
  if (!init) return undefined;
  if (ts.isStringLiteral(init)) return init;
  return ts.isJsxExpression(init) ? init.expression : undefined;
}

describe('REV mobile-ux-02 "Back to home" on the top-up status never asks "Leave without saving?" for a New order left under it', () => {
  // The shop app's routes, read from its navigator, in order (Home is the first, so the initial one).
  const routeNames = jsx(parse('navigation/DistributorStack.tsx'), 'Stack.Screen').map((screen) => {
    const name = attributeExpression(screen, 'name');
    if (!name || !ts.isStringLiteral(name)) throw new Error('a Stack.Screen without a literal name');
    return name.text;
  });
  const router = StackRouter({});
  const options = { routeNames, routeParamList: {}, routeGetIdList: {} };
  const step = (state: StackState, action: Parameters<typeof router.getStateForAction>[1]): StackState => {
    const next = router.getStateForAction(state, action, options);
    if (!next) throw new Error(`the router refused ${action.type}`);
    return next as StackState;
  };

  it('REV mobile-ux-02 the status screen\'s "Back to home" navigates to Home; it never pops to the top', () => {
    const source = parse('screens/distributor/topup/TopupStatusScreen.tsx');
    const buttons = jsx(source, 'Button').filter((b) => attributeExpression(b, 'label')?.getText().includes("'topup.status.backHome'"));
    expect(buttons).toHaveLength(1);
    const onPress = attributeExpression(buttons[0], 'onPress');
    expect(onPress && ts.isIdentifier(onPress)).toBe(true);
    const handler = findAll(source, ts.isVariableDeclaration).find((d) => d.name.getText() === onPress!.getText());
    expect(handler?.initializer?.getText()).toBe("() => navigation.navigate('Home')");
    expect(source.getFullText()).not.toMatch(/popToTop\s*\(/);
  });

  it('REV mobile-ux-02 from Home → New order → (Add money) → Status, it lands on Home, and New order\'s guard lets it through', () => {
    expect(routeNames[0]).toBe('Home');
    // FEE-008: Check and place → Add money → … → Send for checking; showSentTopup leaves
    // [Home, NewOrder, TopupStatus], with the New order draft (a customer chosen) still mounted.
    let state: StackState = router.getInitialState(options);
    state = step(state, CommonActions.navigate('NewOrder'));
    state = step(state, CommonActions.navigate('TopupStatus', { id: 'topup-1' }));
    expect(state.routes.map((route) => route.name)).toEqual(['Home', 'NewOrder', 'TopupStatus']);

    // What `navigation.navigate('Home')` dispatches (@react-navigation/core's helpers).
    const backHome = CommonActions.navigate('Home');
    const after = step(state, backHome);
    expect(after.routes.map((route) => route.name)).toEqual(['Home']);
    expect(after.routes[0].key).toBe(state.routes[0].key);

    // Every removed screen gets `beforeRemove` with this action. New order's guard is dirty, and
    // asks only when the action is leaving by hand: here it lets the navigation through.
    const removed = state.routes.filter((route) => !after.routes.some((kept) => kept.key === route.key)).map((r) => r.name);
    expect(removed).toEqual(['NewOrder', 'TopupStatus']);
    expect(isLeavingByHand(backHome)).toBe(false);
  });

  it('REV mobile-ux-02 Back, the header arrow and pop-to-top still ask on a form with input; saves that move on never do', () => {
    // The shop's form guard (useFormGuard) decides with this rule, and keeps no list of its own.
    const guard = parse('screens/distributor/shared/navigation.ts').getFullText();
    expect(guard).toContain("addListener('beforeRemove'");
    expect(guard).toContain('!isLeavingByHand(event.data.action)');
    expect(guard).not.toMatch(/LEAVING_ACTIONS|'GO_BACK'|'POP_TO_TOP'/);

    expect([...LEAVING_ACTIONS].sort()).toEqual(['GO_BACK', 'POP', 'POP_TO_TOP']);
    expect(isLeavingByHand(CommonActions.goBack())).toBe(true);
    expect(isLeavingByHand(StackActions.pop())).toBe(true);
    expect(isLeavingByHand(StackActions.popToTop())).toBe(true);
    expect(isLeavingByHand(StackActions.replace('OrderDetail', { orderId: 'o-1' }))).toBe(false);
    expect(isLeavingByHand(CommonActions.reset({ index: 0, routes: [{ name: 'Home' }] }))).toBe(false);
    expect(isLeavingByHand(CommonActions.navigate('NewOrder', { clientId: 'c-1', pickedAt: 1 }))).toBe(false);
  });
});

// ---- QueryBoundary, compiled from its source -------------------------------------------------------

/**
 * Compiles a .tsx module the way the app's Babel does (automatic JSX runtime) and runs it with its
 * imports replaced by `stubs`; `react` is the real one.
 */
function loadTsx(relative: string, stubs: Record<string, unknown>): Record<string, unknown> {
  const file = path.join(MOBILE_SRC, relative);
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} as Record<string, unknown> };
  const load = (id: string): unknown => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id in stubs) return stubs[id];
    throw new Error(`${relative} imports ${id}, which this test doesn't stub`);
  };
  new Function('require', 'module', 'exports', outputText)(load, module, module.exports);
  return module.exports;
}

/** A component that renders nothing, named for the paths. */
const Stub = (name: string): React.FC<Record<string, unknown>> => Object.assign(() => null, { displayName: name });

type Element = React.ReactElement<{ children?: React.ReactNode }>;

function isElement(node: unknown): node is Element {
  return React.isValidElement(node as React.ReactNode);
}

/** A lone unkeyed Fragment's children, as React unwraps them; anything else as it is. */
function unwrapped(node: unknown): unknown {
  return isElement(node) && node.type === React.Fragment && node.key === null ? node.props.children : node;
}

function typeName(type: unknown): string {
  if (typeof type === 'string') return type;
  if (type === React.Fragment) return 'Fragment';
  const named = type as { displayName?: string; name?: string };
  return named.displayName ?? named.name ?? 'Component';
}

/**
 * How React finds `target` under a parent with these children: the type and the key (or, unkeyed, the
 * position) at every level. Two renders with the same path keep the same instance (and its state); a
 * different type or position at any level remounts it. A lone unkeyed Fragment is unwrapped, as React
 * does with the children it reconciles; a nested array is a Fragment of its own.
 */
function pathIn(children: unknown, target: unknown): string[] | null {
  const node = unwrapped(children);
  const slots: unknown[] = Array.isArray(node) ? node : [node];
  for (let index = 0; index < slots.length; index++) {
    const found = pathOf(slots[index], index, target);
    if (found) return found;
  }
  return null;
}

function pathOf(child: unknown, index: number, target: unknown): string[] | null {
  if (Array.isArray(child)) {
    const inner = pathIn(child, target);
    return inner ? [`Fragment@${index}`, ...inner] : null;
  }
  if (!isElement(child)) return null;
  const step = child.key !== null ? `${typeName(child.type)}#${child.key}` : `${typeName(child.type)}@${index}`;
  if (child.type === target) return [step];
  // Host views and fragments render their children here; other components' output isn't rendered.
  if (typeof child.type !== 'string' && child.type !== React.Fragment) return null;
  const inner = pathIn(child.props.children, target);
  return inner ? [step, ...inner] : null;
}

/** The top-level slots a render fills (a lone unkeyed Fragment is unwrapped). */
function filledSlots(output: unknown): number {
  const node = unwrapped(output);
  const slots: unknown[] = Array.isArray(node) ? node : [node];
  return slots.filter((slot) => slot !== null && slot !== undefined && slot !== false).length;
}

describe('REV mobile-ux-06 A background refresh that fails or recovers never remounts the data QueryBoundary shows', () => {
  const { QueryBoundary } = loadTsx('ui/QueryBoundary.tsx', {
    'react-i18next': { useTranslation: () => ({ t: (key: string) => key }) },
    'react-native': { Pressable: 'Pressable', View: 'View', StyleSheet: { create: <T,>(styles: T) => styles } },
    '@smartfleet/shared-utils': { formatPkTime: () => '4:12 pm', localDate: () => '2026-10-23' },
    '../i18n': { formatWhenText: () => 'Today, 4:12 pm' },
    './ErrorBanner': { ErrorBanner: Stub('ErrorBanner') },
    './Icon': { Icon: Stub('Icon') },
    './Skeleton': { SkeletonList: Stub('SkeletonList') },
    './Text': { Text: Stub('Text') },
    './tokens': {
      radius: { md: 12 },
      sizes: { touch: 48 },
      space: { sm: 8, md: 12 },
      toneSurfaces: { warning: { background: 'warningSoft', icon: 'warning', text: 'warningText' } },
    },
  }) as { QueryBoundary: (props: Record<string, unknown>) => React.ReactNode };

  // The order screen's case: the order body and, as it used to be, the cancel sheet inside it.
  const OrderBody = Stub('OrderBody');
  const CancelSheet = Stub('CancelSheet');
  const query = (isError: boolean) => ({
    data: { id: 'order-1' },
    error: isError ? new Error('poll failed after its retries') : null,
    isPending: false,
    isError,
    dataUpdatedAt: Date.UTC(2026, 9, 23, 11, 12),
    refetch: () => undefined,
  });
  const render = (isError: boolean, children: () => React.ReactNode) => QueryBoundary({ query: query(isError), children });

  it('REV mobile-ux-06 fresh and stale keep the body at the same type and position, and stale adds only the strip', () => {
    const body = () => React.createElement(OrderBody, { order: 'order-1' });
    const fresh = render(false, body);
    const stale = render(true, body);
    const freshPath = pathIn(fresh, OrderBody);
    expect(freshPath).not.toBeNull();
    // A failed poll (isError with the cached data) and the next good one both keep the body mounted.
    expect(pathIn(stale, OrderBody)).toEqual(freshPath);
    expect(filledSlots(stale)).toBe(filledSlots(fresh) + 1);
  });

  it('REV mobile-ux-06 a sheet rendered with the body keeps its place too (its reason, note and spinner survive)', () => {
    const withSheet = () =>
      React.createElement(React.Fragment, null, React.createElement(OrderBody), React.createElement(CancelSheet, { visible: true }));
    const fresh = render(false, withSheet);
    const stale = render(true, withSheet);
    expect(pathIn(fresh, CancelSheet)).not.toBeNull();
    expect(pathIn(stale, CancelSheet)).toEqual(pathIn(fresh, CancelSheet));
  });

  it('REV mobile-ux-06 the order screen renders its cancel sheet outside the boundary', () => {
    const source = parse('screens/distributor/OrderDetailScreen.tsx');
    const sheets = jsx(source, 'CancelSheet');
    expect(sheets).toHaveLength(1);
    let ancestor: ts.Node | undefined = sheets[0].parent;
    const around: string[] = [];
    while (ancestor) {
      if (ts.isJsxElement(ancestor)) around.push(ancestor.openingElement.tagName.getText());
      ancestor = ancestor.parent;
    }
    expect(around).toContain('Screen');
    expect(around).not.toContain('QueryBoundary');
  });
});

describe('REV mobile-ux-09 My orders: "Active (n)" matches the active rows it polls', () => {
  it('REV mobile-ux-09 a fully loaded active list counts its rows, even when the home count is older', () => {
    // A driver delivered one of 3 active orders: the list polled down to 2 rows, home still says 3.
    expect(activeTabCount({ tab: 'active', rowCount: 2, hasMorePages: false, homeCount: 3 })).toBe(2);
    expect(activeTabCount({ tab: 'active', rowCount: 0, hasMorePages: false, homeCount: 1 })).toBe(0);
  });

  it('REV mobile-ux-09 on Done, with more pages left, or before the first page, the home count stands in', () => {
    expect(activeTabCount({ tab: 'done', rowCount: 12, hasMorePages: false, homeCount: 3 })).toBe(3);
    expect(activeTabCount({ tab: 'active', rowCount: 30, hasMorePages: true, homeCount: 41 })).toBe(41);
    expect(activeTabCount({ tab: 'active', rowCount: null, hasMorePages: false, homeCount: 3 })).toBe(3);
    expect(activeTabCount({ tab: 'active', rowCount: null, hasMorePages: false, homeCount: undefined })).toBeNull();
    expect(activeTabCount({ tab: 'done', rowCount: 5, hasMorePages: false, homeCount: undefined })).toBeNull();
  });

  it('REV mobile-ux-09 My orders labels the Active tab with that rule', () => {
    const source = parse('screens/distributor/OrdersScreen.tsx');
    const calls = findAll(source, ts.isCallExpression).filter((call) => call.expression.getText() === 'activeTabCount');
    expect(calls).toHaveLength(1);
    const declaration = calls[0].parent;
    expect(ts.isVariableDeclaration(declaration) && declaration.name.getText()).toBe('activeCount');
    const argument = calls[0].arguments[0]?.getText().replace(/\s+/g, ' ');
    expect(argument).toContain('rowCount: firstLoad ? null : rows.length');
    expect(argument).toContain('hasMorePages: orders.hasNextPage');
    expect(argument).toContain('homeCount: home.data?.orders.active');
    expect(source.getFullText()).toMatch(/t\('orders\.list\.active', \{ count: activeCount \}\)/);
  });
});
