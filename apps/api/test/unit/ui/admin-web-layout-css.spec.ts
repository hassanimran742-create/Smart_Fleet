/**
 * Review fixes on the office website's layout (UX_ADMIN §1.3, §2.3, §2.8, §2.12). The website has no UI
 * test runner, so this applies the CSS cascade itself to the real stylesheets (src/ui/*.css and every
 * features/*\/*.css): for a modelled element at a viewport width it finds the declaration that wins by
 * !important, specificity, then source order, honouring @media widths and @supports. Each rule-order bug
 * of the review is checked in both bundle orders (pages' stylesheets before the design system, as the
 * old main.tsx loaded them, and after it, as it loads them now), so a fix that depends on load order
 * fails here. The before/after screenshots are in the review's fix-web/shots folder.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const ADMIN_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'admin-web', 'src');

// ---- A small CSS parser ------------------------------------------------------------------------------

interface Declaration {
  value: string;
  important: boolean;
}

interface Rule {
  selectors: string[];
  declarations: Map<string, Declaration>;
  /** The @media and @supports preludes around the rule, outermost first. */
  conditions: string[];
  order: number;
  file: string;
}

/** Splits on `separator` outside parentheses, brackets and quotes. */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function parseDeclarations(body: string): Map<string, Declaration> {
  const out = new Map<string, Declaration>();
  for (const item of splitTop(body, ';')) {
    const colon = item.indexOf(':');
    if (colon < 0) continue;
    const property = item.slice(0, colon).trim().toLowerCase();
    let value = item.slice(colon + 1).trim();
    const important = /!\s*important$/i.test(value);
    if (important) value = value.replace(/!\s*important$/i, '').trim();
    out.set(property, { value: value.replace(/\s+/g, ' '), important });
  }
  return out;
}

function parseCss(text: string, file: string, counter: { next: number }): Rule[] {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const parseBlock = (block: string, conditions: string[]): void => {
    let i = 0;
    while (i < block.length) {
      const open = block.indexOf('{', i);
      if (open < 0) break;
      const prelude = block.slice(i, open).split(';').pop()!.trim();
      let depth = 1;
      let j = open + 1;
      while (j < block.length && depth > 0) {
        if (block[j] === '{') depth++;
        else if (block[j] === '}') depth--;
        j++;
      }
      const body = block.slice(open + 1, j - 1);
      if (/^@(media|supports)\b/i.test(prelude)) parseBlock(body, [...conditions, prelude]);
      else if (!prelude.startsWith('@')) {
        rules.push({ selectors: splitTop(prelude, ','), declarations: parseDeclarations(body), conditions, order: counter.next++, file });
      }
      i = j;
    }
  };
  parseBlock(source, []);
  return rules;
}

// ---- Selectors: specificity and matching -----------------------------------------------------------

/** A modelled element: its tag, classes and attributes, its parent, and whether it is a first child. */
interface El {
  tag: string;
  classes?: string[];
  attrs?: Record<string, string>;
  firstChild?: boolean;
  parent?: El;
}

type Specificity = [number, number, number];

interface Compound {
  tag: string | null;
  ids: string[];
  classes: string[];
  attrs: { name: string; value: string | null }[];
  pseudoClasses: { name: string; arg: string | null }[];
  pseudoElement: boolean;
}

function parseCompound(text: string): Compound {
  const compound: Compound = { tag: null, ids: [], classes: [], attrs: [], pseudoClasses: [], pseudoElement: false };
  let i = 0;
  const ident = (): string => {
    const match = /^-?[_a-zA-Z0-9-]+/.exec(text.slice(i));
    const name = match ? match[0] : '';
    i += name.length;
    return name;
  };
  if (text[0] === '*') i = 1;
  else if (/[a-zA-Z]/.test(text[0] ?? '')) compound.tag = ident().toLowerCase();
  while (i < text.length) {
    const ch = text[i];
    if (ch === '.') {
      i++;
      compound.classes.push(ident());
    } else if (ch === '#') {
      i++;
      compound.ids.push(ident());
    } else if (ch === '[') {
      const close = text.indexOf(']', i);
      const inner = text.slice(i + 1, close);
      const eq = inner.indexOf('=');
      compound.attrs.push(
        eq < 0 ? { name: inner.trim(), value: null } : { name: inner.slice(0, eq).trim(), value: inner.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '') },
      );
      i = close + 1;
    } else if (ch === ':') {
      if (text[i + 1] === ':') {
        compound.pseudoElement = true;
        i += 2;
        ident();
        continue;
      }
      i++;
      const name = ident().toLowerCase();
      let arg: string | null = null;
      if (text[i] === '(') {
        let depth = 1;
        let j = i + 1;
        while (j < text.length && depth > 0) {
          if (text[j] === '(') depth++;
          else if (text[j] === ')') depth--;
          j++;
        }
        arg = text.slice(i + 1, j - 1);
        i = j;
      }
      if (name === 'before' || name === 'after') compound.pseudoElement = true;
      else compound.pseudoClasses.push({ name, arg });
    } else i++;
  }
  return compound;
}

/** A complex selector as compounds and the combinators between them (`' '` or `'>'`, `'+'`, `'~'`). */
function parseSelector(selector: string): { compounds: Compound[]; combinators: string[] } {
  const tokens = selector.replace(/\s*([>+~])\s*/g, ' $1 ').trim().split(/\s+(?![^(]*\))/);
  const compounds: Compound[] = [];
  const combinators: string[] = [];
  let pending = ' ';
  for (const token of tokens) {
    if (token === '>' || token === '+' || token === '~') {
      pending = token;
      continue;
    }
    if (compounds.length > 0) combinators.push(pending);
    compounds.push(parseCompound(token));
    pending = ' ';
  }
  return { compounds, combinators };
}

function specificityOf(selector: string): Specificity {
  const total: Specificity = [0, 0, 0];
  for (const compound of parseSelector(selector).compounds) {
    total[0] += compound.ids.length;
    total[1] += compound.classes.length + compound.attrs.length;
    for (const pseudo of compound.pseudoClasses) {
      if (pseudo.name === 'where') continue;
      if ((pseudo.name === 'not' || pseudo.name === 'is') && pseudo.arg) {
        const inner = splitTop(pseudo.arg, ',').map(specificityOf).sort(compareSpecificity).pop()!;
        total[0] += inner[0];
        total[1] += inner[1];
        total[2] += inner[2];
      } else total[1] += 1;
    }
    if (compound.tag) total[2] += 1;
    if (compound.pseudoElement) total[2] += 1;
  }
  return total;
}

function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function matchesCompound(compound: Compound, el: El): boolean {
  if (compound.pseudoElement) return false;
  if (compound.tag && compound.tag !== el.tag) return false;
  if (compound.ids.length > 0) return false;
  const classes = el.classes ?? [];
  if (!compound.classes.every((name) => classes.includes(name))) return false;
  for (const attr of compound.attrs) {
    const value = el.attrs?.[attr.name];
    if (value === undefined || (attr.value !== null && value !== attr.value)) return false;
  }
  for (const pseudo of compound.pseudoClasses) {
    if (pseudo.name === 'first-child') {
      if (!el.firstChild) return false;
    } else if (pseudo.name === 'root') {
      if (el.tag !== 'html') return false;
    } else if (pseudo.name === 'not') {
      if (splitTop(pseudo.arg ?? '', ',').some((inner) => matchesSelector(inner, el))) return false;
    } else return false; // :hover, :focus-visible, :disabled… are states the modelled element isn't in
  }
  return true;
}

function matchesSelector(selector: string, el: El): boolean {
  const { compounds, combinators } = parseSelector(selector);
  const matchFrom = (index: number, candidate: El | undefined): boolean => {
    if (!candidate || !matchesCompound(compounds[index], candidate)) return false;
    if (index === 0) return true;
    const combinator = combinators[index - 1];
    if (combinator === '>') return matchFrom(index - 1, candidate.parent);
    if (combinator === ' ') {
      for (let up = candidate.parent; up; up = up.parent) if (matchFrom(index - 1, up)) return true;
      return false;
    }
    return false; // sibling combinators: no modelled siblings
  };
  return matchFrom(compounds.length - 1, el);
}

// ---- Conditions and the cascade --------------------------------------------------------------------

function conditionHolds(prelude: string, width: number): boolean {
  if (/^@supports/i.test(prelude)) return true; // the office's browsers support dvh
  const query = prelude.replace(/^@media\s*/i, '').trim();
  return splitTop(query, ',').some((alternative) =>
    alternative.split(/\s+and\s+/i).every((part) => {
      const feature = /\(\s*(min|max)-width\s*:\s*([\d.]+)px\s*\)/i.exec(part);
      if (feature) return feature[1].toLowerCase() === 'max' ? width <= Number(feature[2]) : width >= Number(feature[2]);
      if (/^(screen|all)$/i.test(part.trim())) return true;
      return false; // print, prefers-reduced-motion, pointer: coarse…
    }),
  );
}

/** The value of `property` that wins for `el` at a viewport `width`, or null when no rule sets it. */
function computed(rules: Rule[], el: El, property: string, width: number): string | null {
  let best: { declaration: Declaration; specificity: Specificity; order: number } | null = null;
  for (const rule of rules) {
    const declaration = rule.declarations.get(property);
    if (!declaration || !rule.conditions.every((condition) => conditionHolds(condition, width))) continue;
    const matching = rule.selectors.filter((selector) => matchesSelector(selector, el));
    if (matching.length === 0) continue;
    const specificity = matching.map(specificityOf).sort(compareSpecificity).pop()!;
    const wins =
      !best ||
      (declaration.important && !best.declaration.important) ||
      (declaration.important === best.declaration.important &&
        (compareSpecificity(specificity, best.specificity) > 0 ||
          (compareSpecificity(specificity, best.specificity) === 0 && rule.order > best.order)));
    if (wins) best = { declaration, specificity, order: rule.order };
  }
  return best ? best.declaration.value : null;
}

// ---- The stylesheets, in both bundle orders ----------------------------------------------------------

const read = (relative: string) => fs.readFileSync(path.join(ADMIN_SRC, relative), 'utf8');
const DESIGN_SYSTEM = ['ui/tokens.css', 'ui/base.css', 'ui/components.css'];
const FEATURES = fs
  .readdirSync(path.join(ADMIN_SRC, 'features'))
  .flatMap((dir) =>
    fs
      .readdirSync(path.join(ADMIN_SRC, 'features', dir))
      .filter((name) => name.endsWith('.css'))
      .map((name) => `features/${dir}/${name}`),
  );

function load(files: string[]): Rule[] {
  const counter = { next: 0 };
  return files.flatMap((file) => parseCss(read(file), file, counter));
}

const ORDERS: Record<string, Rule[]> = {
  'pages before the design system': load([...FEATURES, ...DESIGN_SYSTEM]),
  'pages after the design system': load([...DESIGN_SYSTEM, ...FEATURES]),
};

/** Builds a chain of elements, outermost first; the last one is returned. */
function chain(...items: Array<Omit<El, 'parent'>>): El {
  let parent: El | undefined;
  for (const item of items) parent = { ...item, parent };
  return parent!;
}

type Item = Omit<El, 'parent'>;
const SHELL: Item[] = [
  { tag: 'html' },
  { tag: 'body' },
  { tag: 'div', attrs: { id: 'root' } },
  { tag: 'div', classes: ['sf-app'], attrs: { 'data-env': 'test' } },
  { tag: 'div', classes: ['sf-shell'] },
];
const PAGE: Item[] = [...SHELL, { tag: 'div', classes: ['sf-shell__body'] }, { tag: 'main', classes: ['sf-main'] }, { tag: 'div', classes: ['sf-main__inner'] }];

const LAPTOPS = [1024, 1280, 1366];
const TABLET = 768;

describe.each(Object.keys(ORDERS))('admin-web layout CSS (%s)', (orderName) => {
  const rules = ORDERS[orderName];

  it('REV web-ux-01 the Settings section Select hides at 1024 px and up (the local menu shows) and shows below', () => {
    const select = chain(...PAGE, { tag: 'div', classes: ['sf-settings'] }, { tag: 'div', classes: ['sf-settings__layout'] }, {
      tag: 'div',
      classes: ['sf-field', 'sf-settings__section-select'],
    });
    const menu = chain(...PAGE, { tag: 'div', classes: ['sf-settings'] }, { tag: 'div', classes: ['sf-settings__layout'] }, {
      tag: 'nav',
      classes: ['sf-settings__menu'],
    });
    const hidden = (el: El, width: number) => computed(rules, el, 'display', width) === 'none';
    for (const width of LAPTOPS) {
      expect({ width, selectHidden: hidden(select, width), menuHidden: hidden(menu, width) }).toEqual({ width, selectHidden: true, menuHidden: false });
    }
    expect({ select: computed(rules, select, 'display', TABLET), menuHidden: hidden(menu, TABLET) }).toEqual({ select: 'block', menuHidden: true });
    // Below 1024 px the Select sits right above the panel (its own margin is 0; the grid gap spaces it).
    expect(computed(rules, select, 'margin-block-end', TABLET)).toBe('0');
  });

  it('REV web-ux-02 the docked navigation is one viewport high (its list scrolls inside it), not as tall as the page', () => {
    const nav = chain(...SHELL, { tag: 'nav', classes: ['sf-nav', 'sf-nav--docked', 'sf-shell__nav'] });
    const list = chain(...SHELL, { tag: 'nav', classes: ['sf-nav', 'sf-nav--docked', 'sf-shell__nav'] }, { tag: 'div', classes: ['sf-nav__scroll'] });
    for (const width of LAPTOPS) {
      expect({ width, blockSize: computed(rules, nav, 'block-size', width), position: computed(rules, nav, 'position', width) }).toEqual({
        width,
        blockSize: 'calc(100dvh - var(--env-h, 0px))',
        position: 'sticky',
      });
      expect(computed(rules, list, 'overflow-y', width)).toBe('auto');
    }
    // Under 1024 px it is hidden (the menu sheet takes over), and the sheet's copy still fills its sheet.
    expect(computed(rules, nav, 'display', TABLET)).toBe('none');
    const sheetNav = chain({ tag: 'body' }, { tag: 'div', classes: ['sf-nav-sheet'] }, { tag: 'nav', classes: ['sf-nav', 'sf-nav--overlay'] });
    expect(computed(rules, sheetNav, 'block-size', TABLET)).toBe('100%');
  });

  it('REV web-ux-03 a table scroll area contains absolutely positioned content, so a hidden header never widens the page', () => {
    const scroll = chain(...PAGE, { tag: 'div', classes: ['sf-table-card'] }, { tag: 'div', classes: ['sf-table-scroll'] });
    for (const width of [...LAPTOPS, TABLET]) {
      expect({ width, position: computed(rules, scroll, 'position', width), overflowX: computed(rules, scroll, 'overflow-x', width) }).toEqual({
        width,
        position: 'relative',
        overflowX: 'auto',
      });
    }
  });

  it('REV web-ux-05 a toned row keeps its sticky first cell (and the cell still holds the 4 px edge)', () => {
    const row = (toned: boolean): El =>
      chain(
        ...PAGE,
        { tag: 'div', classes: ['sf-table-card'] },
        { tag: 'div', classes: ['sf-table-scroll'] },
        { tag: 'table', classes: ['sf-table'] },
        { tag: 'tbody' },
        { tag: 'tr', classes: ['sf-table__row', 'is-clickable', ...(toned ? ['has-tone', 'sf-tone-warning'] : [])] },
        { tag: 'td', classes: ['is-sticky'], firstChild: true },
      );
    for (const width of [TABLET, 1024, 1366]) {
      expect({ width, toned: computed(rules, row(true), 'position', width), plain: computed(rules, row(false), 'position', width) }).toEqual({
        width,
        toned: 'sticky',
        plain: 'sticky',
      });
    }
    // A toned row's first cell that isn't sticky still gets `relative`, the containing block of its edge.
    const plainCell = chain({ tag: 'table', classes: ['sf-table'] }, { tag: 'tbody' }, { tag: 'tr', classes: ['sf-table__row', 'has-tone'] }, {
      tag: 'td',
      firstChild: true,
    });
    expect(computed(rules, plainCell, 'position', 1366)).toBe('relative');
  });

  it('REV web-ux-06 the menu button shows only under 1024 px, beside no sidebar or rail', () => {
    const button = chain(...SHELL, { tag: 'div', classes: ['sf-shell__body'] }, { tag: 'header', classes: ['sf-topbar'] }, {
      tag: 'button',
      classes: ['sf-icon-btn', 'sf-icon-btn--ghost', 'sf-icon-btn--md', 'sf-topbar__menu'],
    });
    for (const width of LAPTOPS) expect({ width, display: computed(rules, button, 'display', width) }).toEqual({ width, display: 'none' });
    expect(computed(rules, button, 'display', TABLET)).toBe('inline-grid');
    // Any other icon button keeps its own display.
    const other = chain({ tag: 'div' }, { tag: 'button', classes: ['sf-icon-btn', 'sf-icon-btn--ghost', 'sf-icon-btn--md'] });
    expect(computed(rules, other, 'display', 1366)).toBe('inline-grid');
  });
});

describe('admin-web stylesheet order and the price grid', () => {
  it('REV web-ux-01 main.tsx loads the design system before the router, so page stylesheets come after it', () => {
    const main = ts.createSourceFile('main.tsx', read('main.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const imports = main.statements.filter(ts.isImportDeclaration).map((node) => (node.moduleSpecifier as ts.StringLiteral).text);
    const router = imports.indexOf('./app/router');
    expect(router).toBeGreaterThan(-1);
    for (const sheet of ['./ui/tokens.css', './ui/base.css', './ui/components.css']) {
      expect({ sheet, before: imports.indexOf(sheet) > -1 && imports.indexOf(sheet) < router }).toEqual({ sheet, before: true });
    }
  });

  it('REV web-ux-03 the price grid hides Status under 1024 px (priority 2, UX_ADMIN §2.3)', () => {
    const file = 'features/prices/PricesPage.tsx';
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const columns: ts.ObjectLiteralExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isObjectLiteralExpression(node) &&
        node.properties.some((p) => ts.isPropertyAssignment(p) && p.name.getText() === 'id' && ts.isStringLiteral(p.initializer) && p.initializer.text === 'status')
      ) {
        columns.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(columns).toHaveLength(1);
    const priority = columns[0].properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === 'priority');
    expect(priority?.initializer.getText()).toBe('2');
  });
});
