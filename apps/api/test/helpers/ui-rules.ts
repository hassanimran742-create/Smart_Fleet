/**
 * Static UI rules for the shop and driver apps and the office website (UX_MOBILE §2.2, §6; UX_ADMIN
 * §1.6, §2.11, §2.12; README rule 4). Used by test/unit/ui-static-rules.spec.ts (UXQ-011).
 *
 * - No literal on-screen text in JSX: text nodes and text props (`title`, `label`, `placeholder`, …)
 *   come from i18n keys.
 * - No `Alert.alert`, and no `window.alert`, `window.confirm` or `window.prompt`.
 * - No hex colour literals outside the design tokens.
 * - No "Rs." and no "On hold" anywhere in copy or code.
 * - No raw enum values (UPPER_SNAKE words such as PAID_VIA_LEDGER) in English copy.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

export const APPS_DIR = path.resolve(__dirname, '..', '..', '..');

export interface RuleHit {
  rule: 'jsx-text' | 'text-prop' | 'native-alert' | 'hex-colour' | 'rs-dot' | 'on-hold' | 'raw-enum';
  file: string;
  line: number;
  text: string;
}

/** Props whose string value people read or hear. */
const TEXT_PROPS = new Set([
  'title',
  'label',
  'placeholder',
  'alt',
  'aria-label',
  'accessibilityLabel',
  'accessibilityHint',
  'loadingLabel',
  'message',
  'description',
  'helperText',
  'subtitle',
]);

const HEX_COLOUR = /['"`]#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})['"`]/;
const NATIVE_ALERT = /\bAlert\.alert\s*\(|\bwindow\.(?:alert|confirm|prompt)\s*\(/;
const RS_DOT = /\bRs\.(?!\w)/;
const ON_HOLD = /\bon hold\b/i;
/** An enum value written as one UPPER_SNAKE word, e.g. PAID_VIA_LEDGER. */
const RAW_ENUM = /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/;

/** Lists `.ts`/`.tsx` files under `dir`, skipping tests, declaration files and the given folders. */
export function listSources(dir: string, skip: readonly string[] = []): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules' || skip.includes(entry.name)) continue;
      out.push(...listSources(full, skip));
    } else if (/\.tsx?$/.test(entry.name) && !/\.(spec|test)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function relative(file: string): string {
  return path.relative(APPS_DIR, file).split(path.sep).join('/');
}

function lineOf(source: ts.SourceFile, pos: number): number {
  return source.getLineAndCharacterOfPosition(pos).line + 1;
}

/** Literal JSX text and literal text props, read from the syntax tree (comments never count). */
function jsxHits(file: string, source: ts.SourceFile): RuleHit[] {
  const hits: RuleHit[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.getText(source).trim();
      if (/[A-Za-z]{2,}/.test(text)) hits.push({ rule: 'jsx-text', file: relative(file), line: lineOf(source, node.getStart(source)), text });
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(source);
      const init = node.initializer;
      const literal =
        ts.isStringLiteral(init)
          ? init.text
          : ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))
            ? init.expression.text
            : null;
      if (literal !== null && TEXT_PROPS.has(name) && /[A-Za-z]{2,}/.test(literal)) {
        hits.push({ rule: 'text-prop', file: relative(file), line: lineOf(source, node.getStart(source)), text: `${name}="${literal}"` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

/** String literals only (so code words and comments never count), with their line. */
function stringLiterals(source: ts.SourceFile): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push({ text: node.text, line: lineOf(source, node.getStart(source)) });
    } else if (ts.isTemplateExpression(node)) {
      out.push({ text: node.head.text, line: lineOf(source, node.getStart(source)) });
      for (const span of node.templateSpans) out.push({ text: span.literal.text, line: lineOf(source, span.getStart(source)) });
    } else if (ts.isJsxText(node)) {
      out.push({ text: node.getText(source), line: lineOf(source, node.getStart(source)) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

export interface ScanOptions {
  /** Check JSX text and text props (screens and components). */
  jsx?: boolean;
  /** Allow hex colours (the design-token files). */
  allowHex?: boolean;
  /** The file is English copy (an i18n resource): check for raw enum values in its strings. */
  copy?: boolean;
}

/** Scans one file. Code lines are matched on their text with comments removed. */
export function scanFile(file: string, options: ScanOptions = {}): RuleHit[] {
  const text = fs.readFileSync(file, 'utf8');
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const hits: RuleHit[] = [];
  if (options.jsx) hits.push(...jsxHits(file, source));

  // Code with comments blanked out, line by line, for the call and colour rules.
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  withoutComments.split('\n').forEach((line, index) => {
    if (NATIVE_ALERT.test(line)) hits.push({ rule: 'native-alert', file: relative(file), line: index + 1, text: line.trim() });
    if (!options.allowHex && HEX_COLOUR.test(line)) hits.push({ rule: 'hex-colour', file: relative(file), line: index + 1, text: line.trim() });
  });

  for (const literal of stringLiterals(source)) {
    if (RS_DOT.test(literal.text)) hits.push({ rule: 'rs-dot', file: relative(file), line: literal.line, text: literal.text });
    if (ON_HOLD.test(literal.text)) hits.push({ rule: 'on-hold', file: relative(file), line: literal.line, text: literal.text });
    if (options.copy && RAW_ENUM.test(literal.text)) hits.push({ rule: 'raw-enum', file: relative(file), line: literal.line, text: literal.text });
  }
  return hits;
}

/** Formats hits for an assertion message. */
export function describeHits(hits: readonly RuleHit[]): string[] {
  return hits.map((hit) => `${hit.rule} ${hit.file}:${hit.line} ${hit.text.slice(0, 120)}`);
}
