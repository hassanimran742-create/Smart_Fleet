/**
 * Review finding (data integrity, low): concurrent load scans lose inventory-lot decrements.
 *
 * custody.service.ts adjustInventory decrements the origin lot with a read-modify-write
 * (`findUnique`, then `upsert` with `count: existing.count - 1`) and no lock. Each legacy scan locks only
 * its own trip and cylinder, so two drivers loading the same size at one store at the same moment both
 * read the same count and both write count - 1. The store's FULL lot (read by GET /inventory/me,
 * /inventory/by-store and the office legacy screens) then drifts above the cylinders really there.
 *
 * Fixed (money-data-06): each lot count changes in one guarded statement (decrement where count > 0,
 * increment), after an insert-if-missing of the lot.
 */
import type { INestApplication } from '@nestjs/common';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { createDriver } from '../../helpers/factories';
import { createStandardData } from '../../helpers/standard-data';
import { OrdersFixture, together } from '../../orders/support/fixture';
import { createOrdersTestApp, freshSettings } from '../../orders/support/orders-app';

jest.setTimeout(120_000);

describeDb('review money-data: inventory lots under parallel load scans', () => {
  let app: INestApplication;
  let f: OrdersFixture;

  beforeAll(async () => {
    app = await createOrdersTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    freshSettings(app);
    f = new OrdersFixture(app, await createStandardData({ cylinders: true }));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('four drivers loading 11.8 kg cylinders at Ahmed Gas Store at once: the store lot drops by four', async () => {
    const { std } = f;
    const lotKey = { holderType: 'STORE' as const, holderId: std.DA.homeStoreId, distributorId: std.DA.id, cylinderTypeId: std.sizes.kg11_8, state: 'FULL' as const };
    // The standard data has 20 FULL 11.8 kg cylinders in the store (AG-C0001..AG-C0020); the lot agrees.
    await f.db.inventoryLot.create({ data: { ...lotKey, count: 20 } });
    const drivers = [std.DR1, std.DR2, await createDriver({ zone: std.zones.North }), await createDriver({ zone: std.zones.North })];
    const trips: string[] = [];
    for (const driver of drivers) trips.push((await f.assign((await f.x1()).id, driver)).tripId);

    const scans = await together(...drivers.map((driver, i) => f.loadScan(driver, trips[i], `AG-C000${i + 1}`)));
    expect(scans.map((scan) => scan.status)).toEqual([201, 201, 201, 201]);

    const lot = await f.db.inventoryLot.findUniqueOrThrow({ where: { inventory_unique: lotKey } });
    const inStore = await f.db.cylinder.count({
      where: { custodyType: 'STORE', custodyId: std.DA.homeStoreId, cylinderTypeId: std.sizes.kg11_8, state: 'FULL' },
    });
    expect({ lot: lot.count, cylindersInStore: inStore }).toEqual({ lot: 16, cylindersInStore: 16 });
  });
});
