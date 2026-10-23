/**
 * Review probe (money): can a price edit and an order's quote interleave so the quote mixes the old base
 * with the new per-size amounts?
 *
 * ZonePriceLookup.priceFor (pricing/zone-price.lookup.ts:143-157) reads the price row and its size rows
 * with one Prisma `findUnique({ include: { sizes } })`, which Prisma runs as two SELECTs (checked with
 * query logging). Under READ COMMITTED a price edit (pricing.service.ts putPrice: UPDATE base, DELETE and
 * re-INSERT sizes, one transaction) that commits between the two gives a total no price ever had. The
 * order's own transaction (orders.service.ts create, `quoteOrder(..., tx)`) reads the same way, so the
 * order is charged that total when no `quotedTotalPaisa` is sent (the installed 0.1.0 app never sends it).
 *
 * The first case drives the HTTP routes; the second calls the lookup in a tight loop while another
 * connection flips the price, to show the window exists.
 *
 * Fixed (money-data-04): priceFor reads the price and its sizes in one SQL statement, so one snapshot.
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ZonePriceLookup } from '../../../src/modules/pricing/zone-price.lookup';
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

  it('HTTP: every quote of X1 is Rs 480 (version A) or Rs 700 (version B), never a mix', async () => {
    const { std } = f;
    const version = (a: boolean) => ({
      basePaisa: a ? '25000' : '30000',
      sizes: [
        { cylinderTypeId: std.sizes.kg6, perCylinderPaisa: '3000' },
        { cylinderTypeId: std.sizes.kg11_8, perCylinderPaisa: a ? '4000' : '10000' },
        { cylinderTypeId: std.sizes.kg15, perCylinderPaisa: '8000' },
        { cylinderTypeId: std.sizes.kg45_4, perCylinderPaisa: a ? '15000' : '20000' },
      ],
    });
    const seen = new Map<string, number>();
    for (let round = 0; round < 100; round++) {
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
    expect([...seen.keys()].sort()).toEqual(['48000', '70000']);
  });

  it('service: the price lookup never returns the base of one version with the sizes of the other', async () => {
    const { std } = f;
    const lookup = app.get(ZonePriceLookup);
    const writer = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    const price = await writer.distributorZonePrice.findUniqueOrThrow({
      where: { distributorId_zoneId: { distributorId: std.DA.id, zoneId: std.zones.North.id } },
    });
    // Version A: base 25000 with the 11.8 kg size at 4000. Version B: base 30000 with it at 10000.
    let stop = false;
    let flips = 0;
    const flipper = (async () => {
      while (!stop) {
        const a = flips % 2 === 0;
        await writer.$transaction([
          writer.$executeRaw`UPDATE distributor_zone_prices SET base_paisa = ${a ? 30000n : 25000n} WHERE id = ${price.id}::uuid`,
          writer.$executeRaw`DELETE FROM distributor_zone_price_sizes WHERE price_id = ${price.id}::uuid`,
          writer.$executeRaw`INSERT INTO distributor_zone_price_sizes (id, price_id, cylinder_type_id, per_cylinder_paisa)
                             VALUES (gen_random_uuid(), ${price.id}::uuid, ${std.sizes.kg11_8}::uuid, ${a ? 10000n : 4000n})`,
        ]);
        flips += 1;
      }
    })();
    const mixed: string[] = [];
    const deadline = Date.now() + 20_000;
    let reads = 0;
    while (Date.now() < deadline && mixed.length === 0) {
      const row = await lookup.priceFor(std.DA.id, std.zones.North.id);
      reads += 1;
      if (!row) continue;
      const size = row.sizes.find((s) => s.cylinderTypeId === std.sizes.kg11_8)?.perCylinderPaisa ?? null;
      const consistent = (row.basePaisa === 25000n && size === 4000n) || (row.basePaisa === 30000n && size === 10000n);
      // A read between the DELETE and the INSERT can't happen (one transaction), so a missing size is a mix too.
      if (!consistent) mixed.push(`base ${row.basePaisa} with 11.8 kg at ${size}`);
    }
    stop = true;
    await flipper;
    await writer.$disconnect();
    expect({ mixed, reads: reads > 0, flips: flips > 0 }).toEqual({ mixed: [], reads: true, flips: true });
  });
});
