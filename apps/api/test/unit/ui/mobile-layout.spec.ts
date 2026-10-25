/**
 * Review fixes on the shop and driver apps' layout and forms (UX_MOBILE §2.2, S1, S5, S7, S8, §5).
 * The phone has no UI test runner and no emulator here, so these read the screens' syntax trees and
 * check the property each fix depends on: what a Modal sets, which style a target gets, where a chip
 * sits, and what a footer button's `disabled` is built from. Each one fails on the code as it was.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const MOBILE_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'mobile', 'src');

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

/** Every JSX element named `tag` (`Modal`, `Stack.Screen`…), by its opening tag. */
function jsx(root: ts.Node, tag: string): JsxTag[] {
  const isTag = (node: ts.Node): node is JsxTag => ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node);
  return findAll(root, isTag).filter((node) => node.tagName.getText() === tag);
}

function attribute(element: JsxTag, name: string): ts.JsxAttribute | undefined {
  return element.attributes.properties.find(
    (property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText() === name,
  );
}

/** The expression inside `name={…}`, or the string of `name="…"`. */
function attributeValue(element: JsxTag, name: string): ts.Expression | undefined {
  const init = attribute(element, name)?.initializer;
  if (!init) return undefined;
  if (ts.isStringLiteral(init)) return init;
  return ts.isJsxExpression(init) ? init.expression : undefined;
}

/** The element whose `label` is `t('<key>')`, e.g. a footer Button. */
function byLabelKey(root: ts.Node, tag: string, key: string): JsxTag {
  const found = jsx(root, tag).filter((element) => attributeValue(element, 'label')?.getText().includes(`'${key}'`));
  expect(found).toHaveLength(1);
  return found[0];
}

/** `StyleSheet.create({ <group>: { <property>: … } })`: the property's initializer text. */
function styleValue(source: ts.SourceFile, group: string, property: string): string | undefined {
  for (const call of findAll(source, ts.isCallExpression)) {
    if (call.expression.getText() !== 'StyleSheet.create') continue;
    const sheet = call.arguments[0];
    if (!sheet || !ts.isObjectLiteralExpression(sheet)) continue;
    const entry = sheet.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === group);
    if (!entry || !ts.isObjectLiteralExpression(entry.initializer)) continue;
    const value = entry.initializer.properties.find(
      (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === property,
    );
    return value?.initializer.getText();
  }
  return undefined;
}

/** The function (component) that contains `node`. */
function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration {
  let current: ts.Node | undefined = node.parent;
  while (current && !(ts.isFunctionDeclaration(current) || ts.isArrowFunction(current) || ts.isFunctionExpression(current))) {
    current = current.parent;
  }
  if (!current) throw new Error('not inside a function');
  return current as ts.FunctionLikeDeclaration;
}

/**
 * Every name `expression` is built from, following the component's own `const x = …` declarations
 * (so `disabled={!canSave}` reaches what `canSave` reads).
 */
function dependsOn(expression: ts.Node, component: ts.Node): Set<string> {
  const declared = new Map<string, ts.Expression>();
  for (const declaration of findAll(component, ts.isVariableDeclaration)) {
    if (ts.isIdentifier(declaration.name) && declaration.initializer) declared.set(declaration.name.text, declaration.initializer);
  }
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !seen.has(node.text)) {
      seen.add(node.text);
      const initializer = declared.get(node.text);
      if (initializer) visit(initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return seen;
}

/** The first statement of `const <name> = () => { … }` in the component. */
function firstStatementOf(component: ts.Node, name: string): string {
  const declaration = findAll(component, ts.isVariableDeclaration).find((d) => d.name.getText() === name);
  const fn = declaration?.initializer;
  if (!fn || !ts.isArrowFunction(fn) || !ts.isBlock(fn.body)) throw new Error(`${name} is not a block arrow function`);
  return fn.body.statements[0]?.getText() ?? '';
}

describe('REV mobile-ux-03 The cancel and "Could not deliver" sheets move above the Android keyboard', () => {
  const sheet = parse('ui/ConfirmSheet.tsx');

  it('REV mobile-ux-03 the sheet\'s Modal is not status-bar translucent, so Android resizes it for the keyboard', () => {
    const modals = jsx(sheet, 'Modal');
    expect(modals).toHaveLength(1);
    // A translucent Modal never fits system windows (RN 0.74 ReactModalHostView.getContentView), so
    // adjustResize can't shrink it and the keyboard covers the note for "Other" and the buttons.
    expect(attribute(modals[0], 'statusBarTranslucent')).toBeUndefined();
  });

  it('REV mobile-ux-03 the sheet shrinks to the room above the keyboard and scrolls, instead of keeping its window-based height', () => {
    expect(styleValue(sheet, 'sheet', 'flexShrink')).toBe('1');
    const animated = jsx(sheet, 'Animated.View');
    expect(animated).toHaveLength(1);
    expect(attributeValue(animated[0], 'style')?.getText()).toContain('styles.sheet');
    expect(jsx(sheet, 'ScrollView')).toHaveLength(1);
  });
});

describe('REV mobile-ux-04 Wallet history shows all three filters on a 360 dp phone', () => {
  it('REV mobile-ux-04 the wallet filters are a three-column grid that wraps, not a sideways row', () => {
    const wallet = parse('screens/distributor/WalletScreen.tsx');
    // The shop's FilterChips moved to ui/ChoiceChips.tsx (UX_PRINCIPLES §3); the old name is gone.
    const chips = [...jsx(wallet, 'FilterChips'), ...jsx(wallet, 'ChoiceChips')];
    expect(chips).toHaveLength(1);
    expect(attributeValue(chips[0], 'columns')?.getText()).toBe('3');

    const filterChips = parse('ui/ChoiceChips.tsx');
    expect(styleValue(filterChips, 'grid', 'flexWrap')).toBe("'wrap'");
    // The chips sit in one wrapping View, with or without `columns`, so none scrolls sideways.
    const grid = jsx(filterChips, 'View').filter((view) => attributeValue(view, 'style')?.getText().includes('styles.grid'));
    expect(grid).toHaveLength(1);
    expect(attributeValue(grid[0], 'accessibilityRole')?.getText()).toBe('"radiogroup"');
    // The words of a chip wrap inside it at large font sizes rather than pushing it off the grid.
    expect(styleValue(filterChips, 'cellLabel', 'flexShrink')).toBe('1');
  });

  it('REV mobile-ux-04 the filters keep their documented names (S7, WAL-002, WAL-006)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { wallet } = require(path.join(MOBILE_SRC, 'i18n', 'en', 'wallet.ts')) as typeof import('../../../../mobile/src/i18n/en/wallet');
    expect(wallet.history.filter).toEqual({
      all: 'All',
      topups: 'Top-ups',
      deliveryCosts: 'Delivery costs',
    });
  });
});

describe('REV mobile-ux-05 The driver\'s trip and stop rows give the customer\'s name the row\'s width', () => {
  it('REV mobile-ux-05 ListRow renders `below` inside its text column, under the title', () => {
    const row = parse('ui/ListRow.tsx');
    const texts = jsx(row, 'View').filter((view) => attributeValue(view, 'style')?.getText() === 'styles.texts');
    expect(texts).toHaveLength(1);
    const column = texts[0].parent;
    expect(ts.isJsxElement(column)).toBe(true);
    const inside = findAll(column, ts.isIdentifier).map((id) => id.text);
    expect(inside).toContain('below');
    expect(inside).not.toContain('trailing');
  });

  it.each(['screens/driver/TodayScreen.tsx', 'screens/driver/TripScreen.tsx'])(
    'REV mobile-ux-05 %s puts every row\'s step chip under the title, not beside it',
    (file) => {
      const rows = jsx(parse(file), 'ListRow');
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        // A trailing chip (69-111 dp) left 83-125 dp for "Deliver to Muhammad Usman" at 18 sp.
        expect(attribute(row, 'trailing')).toBeUndefined();
        const below = attributeValue(row, 'below');
        expect(below && ts.isJsxSelfClosingElement(below) ? below.tagName.getText() : null).toBe('StatusChip');
        expect(below?.getText()).toContain('kind="step"');
      }
    },
  );
});

describe('REV mobile-ux-07 The password Show/Hide is a full-size target in both apps', () => {
  const field = parse('ui/Field.tsx');

  it('REV mobile-ux-07 the field action is at least sizes.touch tall (48 dp shop, 56 dp driver), not touch - 8', () => {
    expect(styleValue(field, 'action', 'minHeight')).toBe('sizes.touch');
    expect(styleValue(field, 'action', 'minWidth')).toBe('sizes.touch');
  });

  it('REV mobile-ux-07 the action spans the box from border to border, so the box keeps its height when the border thickens', () => {
    const actions = jsx(field, 'Pressable').filter((p) => attributeValue(p, 'style')?.getText().includes('styles.action'));
    expect(actions).toHaveLength(1);
    expect(attributeValue(actions[0], 'style')?.getText()).toContain('marginVertical: -borderWidth');
    expect(styleValue(field, 'action', 'alignSelf')).toBe("'stretch'");
  });
});

describe('REV mobile-ux-08 Save and Send say what is missing instead of staying grey', () => {
  const cases = [
    {
      file: 'screens/distributor/AddCustomerScreen.tsx',
      key: 'customers.add.save',
      missing: ['trimmedLabel', 'label', 'canSave'],
      touched: 'setLabelTouched(true);',
      enabledBy: 'priced',
    },
    {
      file: 'screens/distributor/NewAddressScreen.tsx',
      key: 'customers.address.save',
      missing: ['trimmedLabel', 'label', 'canSave'],
      touched: 'setLabelTouched(true);',
      enabledBy: 'priced',
    },
    {
      file: 'screens/distributor/topup/TopupTellUsScreen.tsx',
      key: 'topup.tellUs.submit',
      missing: ['nameOk', 'payerName', 'canSend'],
      touched: 'setNameTouched(true);',
      enabledBy: 'amountOk',
    },
  ];

  it.each(cases)(
    'REV mobile-ux-08 $file: the footer button is not disabled by the field it checks on press',
    ({ file, key, missing, touched, enabledBy }) => {
      const source = parse(file);
      const button = byLabelKey(source, 'Button', key);
      const component = enclosingFunction(button);
      const disabled = attributeValue(button, 'disabled');
      expect(disabled).toBeDefined();
      const reads = dependsOn(disabled!, component);
      for (const name of missing) expect(reads).not.toContain(name);
      expect(reads).toContain(enabledBy);
      // The press marks the field touched before anything else, so its error ("Write the house or
      // street.", "Write the name on the account you paid from.") shows instead of nothing happening.
      const onPress = attributeValue(button, 'onPress')?.getText();
      expect(onPress).toBe('submit');
      expect(firstStatementOf(component, 'submit')).toBe(touched);
    },
  );
});
