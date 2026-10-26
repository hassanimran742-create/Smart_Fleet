/**
 * Review finding (business day, low): the website's "Today" wallet-history preset is a calendar date,
 * but the statement API reads `from`/`to` dates as business days (03:00 cut-off).
 *
 * admin-web ui/FilterBar.tsx presetRange('today') returns `localDate(now)` (the Karachi calendar date),
 * and features/wallets/WalletPage.tsx sends it as `?from=&to=` to
 * GET /admin/distributors/:id/wallet/statement, where wallet/business-day.ts statementBound() turns a
 * `YYYY-MM-DD` into that *business* day (03:00 to 03:00). Between 00:00 and 03:00 Karachi time the
 * preset therefore asked for the business day that starts at 03:00 later that morning: "Today" was empty
 * and a correction recorded half an hour ago was not in it.
 *
 * Fixed (money-data-07, on the website): the wallet history's presets count from the business date
 * (features/wallets/historyDates.ts historyToday, from `GET /app/config` `day`). This case runs that
 * website code on this API's own config and statement.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { localDate } from '@smartfleet/shared-utils';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { createStandardData } from '../../helpers/standard-data';
import { OrdersFixture } from '../../orders/support/fixture';
import { createOrdersTestApp, freshSettings } from '../../orders/support/orders-app';

/* eslint-disable @typescript-eslint/no-var-requires */
// The website's own preset rules (apps/admin-web), as WalletPage.tsx uses them.
const ADMIN_SRC = path.resolve(__dirname, '..', '..', '..', '..', 'admin-web', 'src');
const { historyToday } = require(path.join(ADMIN_SRC, 'features', 'wallets', 'historyDates.ts')) as typeof import('../../../../admin-web/src/features/wallets/historyDates');
const { presetRangeFrom } = require(path.join(ADMIN_SRC, 'ui', 'dateRange.ts')) as typeof import('../../../../admin-web/src/ui/dateRange');
/* eslint-enable @typescript-eslint/no-var-requires */

jest.setTimeout(120_000);

describeDb('review money-data: wallet history "Today" around midnight', () => {
  let app: INestApplication;
  let f: OrdersFixture;

  beforeAll(async () => {
    app = await createOrdersTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    freshSettings(app);
    f = new OrdersFixture(app, await createStandardData());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('REV money-data-07 at 01:30 Karachi time, the "Today" preset shows a correction recorded at 00:30', async () => {
    const { std } = f;
    // A correction recorded at 00:30 Karachi time on Sat 24 Oct 2026 (19:30 UTC on the 23rd). The
    // opening entry of the standard data is older, so this row is the newest; the ledger keeps rows of
    // one distributor in strictly increasing time.
    const at = new Date('2026-10-23T19:30:00.000Z');
    await f.db.$transaction([
      f.db.distributor.update({ where: { id: std.DA.id }, data: { advanceBalancePaisa: { increment: 10_000n } } }),
      f.db.ledgerEntry.create({
        data: {
          distributorId: std.DA.id,
          entryType: 'ADJUSTMENT',
          amountPaisa: 10_000n,
          balanceAfterPaisa: 510_000n,
          reasonCode: 'SYSTEM_ERROR',
          note: 'Correction recorded just after midnight',
          idempotencyKey: `adjust:${randomUUID()}`,
          createdAt: at,
        },
      }),
    ]);
    // One hour later the office opens the wallet page with the "Today" preset.
    const now = new Date('2026-10-23T20:30:00.000Z'); // 01:30 Karachi, Sat 24 Oct
    // The calendar date is already the 24th, which the old preset sent; the business day is still the 23rd.
    expect(localDate(now)).toBe('2026-10-24');
    const config = await f.anonymous().get('/app/config').expect(200);
    const today = presetRangeFrom('today', historyToday(config.body.day, now.getTime()));
    expect(today).toEqual({ preset: 'today', from: '2026-10-23', to: '2026-10-23' });
    const res = await f.as(std.SA1).get(`/admin/distributors/${std.DA.id}/wallet/statement?from=${today.from}&to=${today.to}`).expect(200);
    const notes = (res.body.items as Array<{ note?: string }>).map((item) => item.note);
    expect(notes).toContain('Correction recorded just after midnight');
  });
});
