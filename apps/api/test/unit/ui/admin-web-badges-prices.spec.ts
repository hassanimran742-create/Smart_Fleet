/**
 * Review fixes on the office website's Today badge and price drawer (UX_ADMIN §1.3, §2.3). The website
 * has no UI test runner, so the rules run here on their own:
 * - the "waiting" count behind the Today badge and the "(n)" of the browser tab (web-ux-04);
 * - the price drawer's live example while the base is still blank (web-ux-07). example.ts reads its
 *   words through the website's i18n setup, which needs Vite, so that one module is replaced here by the
 *   website's own English strings (i18n/en/prices.ts) and the shared formatRs.
 */
import * as fs from 'fs';
import * as path from 'path';
import { formatRs } from '@smartfleet/shared-utils';

const ADMIN_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'admin-web', 'src');

/* eslint-disable @typescript-eslint/no-var-requires */
const { navBadgeCounts } = require(path.join(ADMIN_SRC, 'hooks', 'navBadgeCounts.ts')) as typeof import('../../../../admin-web/src/hooks/navBadgeCounts');
const { prices } = require(path.join(ADMIN_SRC, 'i18n', 'en', 'prices.ts')) as typeof import('../../../../admin-web/src/i18n/en/prices');

/** `t('prices:drawer.example.both', values)` over the website's English strings. */
function t(key: string, values: Record<string, unknown> = {}): string {
  const [ns, keyPath] = key.split(':');
  if (ns !== 'prices') throw new Error(`unexpected namespace in ${key}`);
  const template = keyPath.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], prices);
  if (typeof template !== 'string') throw new Error(`no string at ${key}`);
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name]));
}
jest.doMock(path.join(ADMIN_SRC, 'i18n', 'index.ts'), () => ({ __esModule: true, default: { t } }));
jest.doMock(path.join(ADMIN_SRC, 'i18n', 'format.ts'), () => ({ formatRs }));
const { priceExample } = require(path.join(ADMIN_SRC, 'features', 'prices', 'example.ts')) as typeof import('../../../../admin-web/src/features/prices/example');
/* eslint-enable @typescript-eslint/no-var-requires */

type Summary = Parameters<typeof navBadgeCounts>[0] & object;

/** The review's seeded state: 4 top-ups to check, 3 orders needing a driver, 2 distributors missing a price, 1 not started. */
function summary(extra: Partial<Summary> = {}): Summary {
  return {
    topups: { toCheck: 4, oldestWaitingAt: '2026-10-23T03:00:00.000Z', approvedToday: { count: 1, totalPaisa: '500000' } },
    orders: { needsDriver: 3, oldestNeedsDriverAt: '2026-10-23T03:00:00.000Z', inProgress: 1, placedToday: 4, deliveredToday: 1, costTakenTodayPaisa: '88000' },
    prices: {
      missing: [
        { distributorId: 'a', distributorName: 'Ahmed Gas', zones: 1 },
        { distributorId: 'b', distributorName: 'Bilal Gas', zones: 2 },
      ],
    },
    distributors: { waitingToStart: [{ id: 'n', name: 'Noor LPG' }] },
    drivers: { onDuty: 0, total: 2 },
    ...extra,
  };
}

describe('REV web-ux-04 the Today badge and the tab count are top-ups to check + orders needing a driver', () => {
  it('REV web-ux-04 missing prices and distributors waiting to start are Today cards, not part of the count (7, not 10)', () => {
    expect(navBadgeCounts(summary())).toEqual({ waiting: 7, needsDriver: 3, topupsToCheck: 4 });
  });

  it('REV web-ux-04 the count reaches zero when nothing waits, even while a standing condition (a zone without a price) remains', () => {
    const quiet = summary({
      topups: { toCheck: 0, oldestWaitingAt: null, approvedToday: { count: 0, totalPaisa: '0' } },
      orders: { needsDriver: 0, oldestNeedsDriverAt: null, inProgress: 0, placedToday: 0, deliveredToday: 0, costTakenTodayPaisa: '0' },
    });
    expect(navBadgeCounts(quiet).waiting).toBe(0);
  });

  it('REV web-ux-04 from Inc 2 open customer problems join it (G07-22); nothing before the summary loads', () => {
    expect(navBadgeCounts(summary({ problems: { open: 2, oldestOpenAt: '2026-10-23T03:00:00.000Z' } })).waiting).toBe(9);
    expect(navBadgeCounts(undefined)).toEqual({ waiting: 0, needsDriver: 0, topupsToCheck: 0 });
  });

  it('REV web-ux-04 the shell feeds that one count to the Today badge and to the tab title', () => {
    const nav = fs.readFileSync(path.join(ADMIN_SRC, 'app', 'nav.ts'), 'utf8');
    expect(nav).toMatch(/\{ id: 'today', to: '\/today', icon: Sun, badge: 'waiting' \}/);
    const shell = fs.readFileSync(path.join(ADMIN_SRC, 'app', 'AppShell.tsx'), 'utf8');
    expect(shell).toMatch(/const badges = navBadgeCounts\(summary\.data\);/);
    expect(shell).toMatch(/useDocumentTitle\(badges\.waiting, config\.environment\);/);
  });
});

describe('REV web-ux-07 the price example never says "costs Rs 0" for a blank base', () => {
  const sizes: Parameters<typeof priceExample>[1] = [
    { cylinderTypeId: 's6', code: 'STD_6KG', label: '6 kg' },
    { cylinderTypeId: 's11', code: 'STD_11_8KG', label: '11.8 kg' },
  ];

  it('REV web-ux-07 no base yet: no example (the drawer shows a hint instead)', () => {
    expect(priceExample(null, sizes, new Map())).toBeNull();
    expect(priceExample(null, [], new Map())).toBeNull();
    expect(prices.drawer.example.needsBase).toBe('Type the base per order to see an example.');
  });

  it('REV web-ux-07 a typed base gives the example, and Rs 0 typed on purpose still reads as Rs 0', () => {
    expect(priceExample(25000n, sizes, new Map())).toBe('An order of 2 × 6 kg costs Rs 250');
    expect(priceExample(25000n, sizes, new Map([['s11', 4000n]]))).toBe('An order of 2 × 11.8 kg costs Rs 250 + 2 × Rs 40 = Rs 330');
    expect(priceExample(0n, sizes, new Map())).toBe('An order of 2 × 6 kg costs Rs 0');
  });

  it('REV web-ux-07 the drawer passes the base only when it is an amount, and shows the hint otherwise', () => {
    const drawer = fs.readFileSync(path.join(ADMIN_SRC, 'features', 'prices', 'PriceDrawer.tsx'), 'utf8');
    expect(drawer).toMatch(/priceExample\(base\.ok \? base\.paisa : null, grid\.sizes, amounts\)/);
    expect(drawer).not.toMatch(/priceExample\([^)]*0n/);
    expect(drawer).toMatch(/\{example \? <p>\{example\}<\/p> : <p className="sf-prices__muted">\{t\('drawer\.example\.needsBase'\)\}<\/p>\}/);
  });
});
