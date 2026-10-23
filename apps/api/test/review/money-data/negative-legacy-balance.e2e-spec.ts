/**
 * Review (money and data integrity): a legacy wallet that inc1a leaves below zero.
 *
 * The old code debited without a guard (ledger.service.ts debitForOrder, filling-orders complete()), so
 * live data can hold a negative balance whose history adds up to it (the inc1a fixture's DF). inc1a keeps
 * it as it is (no opening entry), and DATA_MODEL §3.5 says inc1b refuses to run until it is "fixed with a
 * super-admin correction". These cases show what the API tells the office and the shop about it.
 *
 * Fixed:
 * - money-data-02 (website only, as verified): the API keeps `integrity.ok` false for a balance below zero,
 *   which the nightly check counts as a break (§8.5), with `differencePaisa` "0"; the website's
 *   integrity line reads that answer as "below zero" and keeps "Record correction" on (N1).
 * - money-data-03: the refusal of an order states the real balance and the real shortfall, as the
 *   quote does (N2).
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { resetDb, getTestPrisma } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { createStandardData } from '../../helpers/standard-data';
import { OrdersFixture } from '../../orders/support/fixture';
import { createOrdersTestApp, freshSettings } from '../../orders/support/orders-app';

/* eslint-disable @typescript-eslint/no-var-requires */
// The website's own integrity rule (apps/admin-web), run on this API's answer.
const { integrityState } = require(path.resolve(__dirname, '..', '..', '..', '..', 'admin-web', 'src', 'features', 'wallets', 'integrity.ts')) as typeof import('../../../../admin-web/src/features/wallets/integrity');
/* eslint-enable @typescript-eslint/no-var-requires */

jest.setTimeout(120_000);

describeDb('review money-data: a legacy negative balance', () => {
  let app: INestApplication;
  let f: OrdersFixture;

  beforeAll(async () => {
    app = await createOrdersTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    freshSettings(app);
    f = new OrdersFixture(app, await createStandardData());
    const db = getTestPrisma();
    // Bilal Gas (DB) as the old code left it: an unguarded Rs 300 refill debit on a zero balance, with
    // its keyless ledger row keyed `legacy:<id>` by inc1a backfill 3.6. The history adds up, so inc1a
    // writes no opening entry.
    await db.$transaction([
      db.distributor.update({ where: { id: f.std.DB.id }, data: { advanceBalancePaisa: -30_000n } }),
      db.ledgerEntry.create({
        data: {
          distributorId: f.std.DB.id,
          entryType: 'ADJUSTMENT',
          amountPaisa: -30_000n,
          balanceAfterPaisa: -30_000n,
          note: 'Filling order 1a2b3c4d — 3 cylinders filled',
          idempotencyKey: `legacy:${randomUUID()}`,
        },
      }),
    ]);
  });

  afterAll(async () => {
    // Leave no broken wallet behind for the run's nightly-check teardown (WAL-020).
    await resetDb();
    await app?.close();
  });

  it('REV money-data-02 N1 a wallet whose history matches but is below zero reads as below zero, not as a history mismatch of Rs 0', async () => {
    const res = await f.as(f.std.SA1).get(`/admin/distributors/${f.std.DB.id}/wallet`).expect(200);
    const detail = res.body as { balancePaisa: string; integrity: { ok: boolean; ledgerSumPaisa: string; differencePaisa: string; checkedAt: string } };
    // The history adds up to the balance exactly; the balance is below zero, which the nightly check
    // counts as a break (§8.5), so `ok` is false with no difference.
    expect({ balance: detail.balancePaisa, ok: detail.integrity.ok, ledgerSum: detail.integrity.ledgerSumPaisa, difference: detail.integrity.differencePaisa }).toEqual({
      balance: '-30000',
      ok: false,
      ledgerSum: '-30000',
      difference: '0',
    });
    // The website used to read `integrity.ok` alone: false showed "The history doesn't match the balance
    // by {{difference}}" (here "Rs 0") and disabled "Record correction", although the history matches and
    // the documented fix for a balance below zero is exactly a super-admin correction (DATA_MODEL §3.5
    // inc1b pre-check). A history that matches must not read as a mismatch: the page's integrity line
    // comes from `integrityState`, and its "Record correction" is disabled only for 'mismatch'
    // (test/unit/ui/admin-web-wallet.spec.ts).
    expect(integrityState(detail)).toBe('belowZero');
  });

  it('N1b the server accepts the documented fix (a correction ADD), which the website now lets the office send', async () => {
    const fix = await f.as(f.std.SA1)
      .post(`/admin/distributors/${f.std.DB.id}/wallet/corrections`)
      .set('Idempotency-Key', randomUUID())
      .send({ direction: 'ADD', amountPaisa: '30000', reasonCode: 'SYSTEM_ERROR', note: 'Clear the old unguarded refill debit' });
    expect(fix.status).toBe(201);
    const after = await f.as(f.std.SA1).get(`/admin/distributors/${f.std.DB.id}/wallet`).expect(200);
    expect(after.body.integrity).toMatchObject({ ok: true, differencePaisa: '0' });
  });

  it('REV money-data-03 N2 an order refused for balance tells the shop what it really needs, as the quote does, not the cost alone', async () => {
    // Bilal Gas's price in South is Rs 300: with a balance of -Rs 300 it needs Rs 600 more.
    const client = await getTestPrisma().client.findUniqueOrThrow({ where: { id: f.std.C3.id } });
    const body = {
      clientId: client.id,
      addressId: f.std.C3.addressId,
      deliveryLabel: "Hina's house",
      lines: [{ cylinderTypeId: f.std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 1 }],
    };
    const quote = await f.as(f.std.DB).post('/orders/quote').send(body).expect(200);
    const place = await f.as(f.std.DB).post('/orders').set('Idempotency-Key', randomUUID()).send(body).expect(409);
    expect({ quoteShortBy: quote.body.wallet.shortByPaisa, placeShortBy: place.body.details.shortByPaisa, placeBalance: place.body.details.balancePaisa })
      .toEqual({ quoteShortBy: '60000', placeShortBy: '60000', placeBalance: '-30000' });
  });
});
