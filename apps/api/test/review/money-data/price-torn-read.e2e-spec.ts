/**
 * Review probe (money): can a price edit and an order's quote interleave so the quote gives a cost no
 * saved price ever had?
 *
 * Found (money-data-04): a price was a base plus per-size rows, read with two SELECTs, so an edit committing
 * between them gave one version's base with the other's amounts. Fixed then with one SQL statement.
 *
 * Since 2026-10-26 the price is ONE delivery cost per order, one row (ADR-08: the size rows are gone), so
 * ZonePriceLookup.priceFor reads one row in one statement. This probe keeps checking that every quote made
 * while the office flips the price is one of the saved costs.
 */
import type { INestApplication } from '@nestjs/common';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { createStandardData, x1OrderBody } from '../../helpers/standard-data';
import { OrdersFixture, together } from '../../orders/support/fixture';
import { createOrdersTestApp, freshSettings } from '../../orders/support/orders-app';

jest.setTimeout(600_000);

describeDb('review money-data: a quote during a price edit', () => {
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

  it('HTTP: every quote of X1 is Rs 250 (version A) or Rs 300 (version B), never anything else', async () => {
    const { std } = f;
    const version = (a: boolean) => ({ basePaisa: a ? '25000' : '30000' });
    const seen = new Map<string, number>();
    for (let round = 0; round < 50; round++) {
      const results = await together(
        f.as(std.SA1).put(`/pricing/prices/${std.DA.id}/${std.zones.North.id}`).send(version(round % 2 === 1)),
        ...Array.from({ length: 6 }, () => f.as(std.DA).post('/orders/quote').send(x1OrderBody(std))),
      );
      for (const quote of results.slice(1)) {
        if (quote.status !== 200) continue;
        const total = String(quote.body.quote.totalPaisa);
        seen.set(total, (seen.get(total) ?? 0) + 1);
      }
    }
    expect([...seen.keys()].sort()).toEqual(['25000', '30000']);
  });
});
