/**
 * The office website's follow-ups of the Inc 2/3 review fixes. The website has no UI test runner, so its rules
 * run here on their own and its pages are read as syntax trees:
 * - OFF-021: the app chip on the Distributors and Drivers lists ("App: up to date" / "App: needs update" / "App:
 *   not opened yet", API_CONTRACT §8.5 step 10): its words, colours, icon and where it shows;
 * - OFF-022: a VAN_NOT_EMPTY alert reads the van's count and the driver's reason from its context (UX_ADMIN §3.7),
 *   never the words of its first raise.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { AppSeenDto } from '@smartfleet/shared-types';
import { APP_STATUSES } from '@smartfleet/shared-types';

const ADMIN_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'admin-web', 'src');

/* eslint-disable @typescript-eslint/no-var-requires */
const { appChipStatus } = require(path.join(ADMIN_SRC, 'ui', 'appChipStatus.ts')) as typeof import('../../../../admin-web/src/ui/appChipStatus');
const { STATUS_ICONS, STATUS_TONES, iconOf, toneOf } = require(path.join(ADMIN_SRC, 'ui', 'statusTones.ts')) as typeof import('../../../../admin-web/src/ui/statusTones');
const { status } = require(path.join(ADMIN_SRC, 'i18n', 'en', 'status.ts')) as typeof import('../../../../admin-web/src/i18n/en/status');
const { legacy } = require(path.join(ADMIN_SRC, 'i18n', 'en', 'legacy.ts')) as typeof import('../../../../admin-web/src/i18n/en/legacy');
const { alertWords, vanNotEmptyContext } = require(path.join(ADMIN_SRC, 'legacy', 'alertWords.ts')) as typeof import('../../../../admin-web/src/legacy/alertWords');
const lucide = require('lucide-react') as typeof import('lucide-react');
/* eslint-enable @typescript-eslint/no-var-requires */

function parse(relative: string): ts.SourceFile {
  const file = path.join(ADMIN_SRC, relative);
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

type JsxTag = ts.JsxSelfClosingElement | ts.JsxOpeningElement;

function jsx(root: ts.Node, tag: string): JsxTag[] {
  const out: JsxTag[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText() === tag) out.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return out;
}

function attribute(element: JsxTag, name: string): string | undefined {
  const property = element.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name);
  const init = property?.initializer;
  if (!init) return undefined;
  if (ts.isStringLiteral(init)) return init.text;
  return ts.isJsxExpression(init) ? init.expression?.getText() : undefined;
}

/** The JSX element (opening tag) a node sits in, the nearest first. */
function enclosingTags(node: ts.Node): string[] {
  const tags: string[] = [];
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isJsxElement(at)) tags.push(at.openingElement.tagName.getText());
  }
  return tags;
}

/** `lt('alerts.vanNotEmpty.…', values)` over the website's English legacy words. */
function lt(key: string, values: Record<string, unknown>): string {
  const template = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], legacy);
  if (typeof template !== 'string') throw new Error(`no string at legacy:${key}`);
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name]));
}

const seen = (over: Partial<AppSeenDto>): AppSeenDto => ({ status: 'UP_TO_DATE', version: '0.1.1', seenAt: '2026-10-25T10:00:00.000Z', ...over });

describe('OFF-021 the app chip on the Distributors and Drivers lists', () => {
  it('OFF-021 each AppStatus has its words, colour and icon: green tick, amber warning sign (never the clock), grey', () => {
    expect(APP_STATUSES).toEqual(['UP_TO_DATE', 'NEEDS_UPDATE', 'NOT_SEEN']);
    expect(status.app).toEqual({ UP_TO_DATE: 'App: up to date', NEEDS_UPDATE: 'App: needs update', NOT_SEEN: 'App: not opened yet' });
    expect(Object.keys(status.app).sort()).toEqual([...APP_STATUSES].sort());
    expect(STATUS_TONES.app).toEqual({ UP_TO_DATE: 'success', NEEDS_UPDATE: 'warning', NOT_SEEN: 'neutral' });
    expect(toneOf('app', 'NEEDS_UPDATE')).toBe('warning');
    expect(iconOf('app', 'NEEDS_UPDATE')).toBe(lucide.TriangleAlert);
    expect(iconOf('app', 'UP_TO_DATE')).toBeUndefined();
    expect(Object.keys(STATUS_ICONS.app ?? {})).toEqual(['NEEDS_UPDATE']);
    // A chip names the thing first, as "Customer: all received" does, and keeps to a few words.
    for (const words of Object.values(status.app)) expect(words.split(/\s+/).length).toBeLessThanOrEqual(4);
  });

  it('OFF-021 the server\'s status shows while the account can sign in; none for a suspended or archived one, or an older server', () => {
    expect(appChipStatus(seen({}), true)).toBe('UP_TO_DATE');
    expect(appChipStatus(seen({ status: 'NEEDS_UPDATE', version: '0.1.0' }), true)).toBe('NEEDS_UPDATE');
    expect(appChipStatus({ status: 'NOT_SEEN', version: null, seenAt: null }, true)).toBe('NOT_SEEN');
    expect(appChipStatus(seen({ status: 'NEEDS_UPDATE' }), false)).toBeNull();
    expect(appChipStatus(undefined, true)).toBeNull();
  });

  it('OFF-021 the Distributors list shows it in the Status cell after the status chip, the Drivers list after the driver\'s chip', () => {
    const shops = parse('features/distributors/DistributorsPage.tsx');
    const [shopChip] = jsx(shops, 'AppChip');
    expect(jsx(shops, 'AppChip')).toHaveLength(1);
    expect(attribute(shopChip, 'app')).toBe('d.app');
    expect(attribute(shopChip, 'active')).toBe("d.status !== 'SUSPENDED'");
    const shopCell = shopChip.parent as ts.JsxElement;
    expect(shopCell.openingElement.getText()).toContain('sf-dist__chips');
    const shopOrder = shopCell.children.filter((c) => !ts.isJsxText(c)).map((c) => c.getText());
    expect(shopOrder[0]).toContain('<StatusChip kind="distributor"');
    expect(shopOrder[shopOrder.length - 1]).toContain('<AppChip');

    const drivers = parse('legacy/DriversScreen.tsx');
    const [driverChip] = jsx(drivers, 'AppChip');
    expect(jsx(drivers, 'AppChip')).toHaveLength(1);
    expect(attribute(driverChip, 'app')).toBe('d.app');
    expect(attribute(driverChip, 'active')).toBe("d.user.status === 'ACTIVE'");
    const driverCell = driverChip.parent as ts.JsxElement;
    const driverOrder = driverCell.children.filter((c) => !ts.isJsxText(c)).map((c) => c.getText());
    expect(driverOrder).toEqual(['<DriverChip driver={d} />', expect.stringContaining('<AppChip')]);
    expect(enclosingTags(driverChip)).toContain('span');

    // The chip itself: the server's status through StatusChip kind "app", the version and time on hover only.
    const chip = fs.readFileSync(path.join(ADMIN_SRC, 'ui', 'AppChip.tsx'), 'utf8');
    expect(chip).toMatch(/<StatusChip kind="app" value=\{status\} \/>/);
    expect(chip).toMatch(/title=\{title\}/);
  });
});

describe('OFF-022 the Alerts page reads a VAN_NOT_EMPTY alert from its context', () => {
  const refreshed = {
    alertType: 'VAN_NOT_EMPTY',
    // The first raise's English, before the 03:00 check counted the van again.
    title: 'LEA-101 still has cylinders on it (2)',
    body: 'LEA-101 still has 2 cylinder(s) on it. The shop must scan them in. Reason: Store closed',
    context: { vehicleId: 'v1', plateNo: 'LEA-101', count: 1, tripId: 't1', leftoverReason: 'Store closed' },
  };

  it('OFF-022 the count is the van\'s now and the reason the driver\'s, in the website\'s words', () => {
    expect(alertWords(refreshed, lt)).toEqual({ title: 'LEA-101 still has cylinders on it (1)', body: 'Reason: Store closed' });
    expect(alertWords({ ...refreshed, context: { ...refreshed.context, leftoverReason: null } }, lt)).toEqual({
      title: 'LEA-101 still has cylinders on it (1)',
      body: null,
    });
    expect(legacy.alerts.vanNotEmpty).toEqual({ title: '{{plate}} still has cylinders on it ({{count}})', reason: 'Reason: {{reason}}' });
  });

  it('OFF-022 another alert, or a context without the plate and a whole count, keeps the server\'s title and body', () => {
    const other = { alertType: 'WALLET_CHECK_MISMATCH', title: 'Wallet check', body: 'Ahmed Gas', context: { count: 1, plateNo: 'X' } };
    expect(alertWords(other, lt)).toEqual({ title: 'Wallet check', body: 'Ahmed Gas' });
    for (const context of [undefined, null, [], {}, { plateNo: 'LEA-101' }, { plateNo: 'LEA-101', count: '1' }, { plateNo: '', count: 1 }, { plateNo: 'LEA-101', count: 1.5 }]) {
      expect(vanNotEmptyContext({ alertType: 'VAN_NOT_EMPTY', context })).toBeNull();
      expect(alertWords({ ...refreshed, context }, lt)).toEqual({ title: refreshed.title, body: refreshed.body });
    }
  });

  it('OFF-022 the alert cards show alertWords, not the stored title and body', () => {
    const screen = parse('legacy/AlertsScreen.tsx');
    const text = screen.getFullText();
    expect(text).toMatch(/const words = alertWords\(a, lt\);/);
    const titles = jsx(screen, 'h3').map((h) => (h.parent as ts.JsxElement).children.map((c) => c.getText()).join(''));
    expect(titles).toContain('{words.title}');
    expect(text).toMatch(/\{words\.body \? <p>\{words\.body\}<\/p> : null\}/);
    expect(text).not.toMatch(/\{a\.title\}|\{a\.body\}/);
  });
});
