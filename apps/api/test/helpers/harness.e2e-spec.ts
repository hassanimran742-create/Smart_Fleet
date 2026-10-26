// The test harness against a real database: `npm run test:e2e` (skipped without DATABASE_URL).
import { CustodyType, CylinderState, UserRole } from '@prisma/client';
import {
  SEEDED_EXPENSE_TYPES,
  createClient,
  createCylinder,
  createCylinderType,
  createDistributor,
  createDriver,
  createStore,
  createSuperAdmin,
  createZone,
  createZonePrice,
  describeDb,
  getTestPrisma,
  resetDb,
  walletMismatches,
} from './index';

describeDb('test harness (database)', () => {
  const db = () => getTestPrisma();

  it('starts each suite from a migrated, truncated database with the seeded expense types', async () => {
    const [distributors, orders, ledger, types, migrations] = await Promise.all([
      db().distributor.count(),
      db().order.count(),
      db().ledgerEntry.count(),
      db().expenseType.findMany({ orderBy: { sortOrder: 'asc' } }),
      db().$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`,
    ]);
    expect([distributors, orders, ledger]).toEqual([0, 0, 0]);
    expect(types.map((t) => t.code)).toEqual(SEEDED_EXPENSE_TYPES.map((t) => t.code));
    expect(types.every((t) => t.archivedAt === null)).toBe(true);
    expect(Number(migrations[0].n)).toBeGreaterThanOrEqual(2);
  });

  it('creates a distributor with its one store, its code and a consistent wallet', async () => {
    const shop = await createDistributor({ balancePaisa: 250_000n });
    const row = await db().distributor.findUniqueOrThrow({ where: { id: shop.id }, include: { homeStore: true, user: true } });
    expect(row.code).toMatch(/^[A-Z][A-Z0-9]{1,5}$/);
    expect(row.homeStoreId).toBe(shop.store.id);
    expect(row.user.role).toBe(UserRole.DISTRIBUTOR);
    expect(row.advanceBalancePaisa).toBe(250_000n);
    expect([row.nextOrderNo, row.nextTopupNo]).toEqual([1, 1]);
    const opening = await db().ledgerEntry.findUniqueOrThrow({ where: { idempotencyKey: `opening:${shop.id}` } });
    expect(opening).toMatchObject({ amountPaisa: 250_000n, balanceAfterPaisa: 250_000n, reasonCode: 'OPENING_BALANCE' });
    expect(await walletMismatches()).toEqual([]);

    const [inside] = await db().$queryRaw<Array<{ ok: boolean }>>`
      SELECT ST_Covers(z.polygon, s.location) AS ok FROM stores s JOIN zones z ON z.id = s.zone_id WHERE s.id = ${shop.store.id}::uuid`;
    expect(inside.ok).toBe(true);
    expect(shop.actor).toEqual({ userId: shop.userId, role: UserRole.DISTRIBUTOR, distributorId: shop.id, tokenVersion: 0 });
  });

  it('refuses a second distributor on the same store (distributors_home_store_id_key)', async () => {
    const shop = await createDistributor();
    await expect(createDistributor({ store: shop.store })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('creates a driver with a van, and one without', async () => {
    const withVan = await createDriver();
    const withoutVan = await createDriver({ withVehicle: false });
    const rows = await db().driver.findMany({ where: { id: { in: [withVan.id, withoutVan.id] } }, include: { currentVehicle: true } });
    expect(rows.find((r) => r.id === withVan.id)?.currentVehicle?.id).toBe(withVan.vehicleId);
    expect(rows.find((r) => r.id === withoutVan.id)?.currentVehicleId).toBeNull();
    expect(withVan.actor.role).toBe(UserRole.DRIVER);
  });

  it('gives a customer address the smallest active zone that covers the pin', async () => {
    const big = await createZone({ bbox: [70.0, 30.0, 70.2, 30.2] });
    const small = await createZone({ bbox: [70.05, 30.05, 70.1, 30.1] });
    await createZone({ bbox: [70.06, 30.06, 70.07, 30.07], isActive: false });
    const shop = await createDistributor({ zone: big });
    const inSmall = await createClient({ distributor: shop, address: { location: { lat: 30.065, lng: 70.065 } } });
    const inBig = await createClient({ distributor: shop, address: { location: { lat: 30.15, lng: 70.15 } } });
    const outside = await createClient({ distributor: shop, address: { location: { lat: 10, lng: 10 } } });
    const atStore = await createClient({ distributor: shop });
    expect(inSmall.zoneId).toBe(small.id);
    expect(inBig.zoneId).toBe(big.id);
    expect(outside.zoneId).toBeNull();
    expect(atStore.location).toEqual(shop.store.location);
    const noAddress = await createClient({ distributor: shop, address: false });
    expect(noAddress.addressId).toBeNull();
  });

  it('creates cylinders held by the store, and one delivery price per distributor per zone', async () => {
    const shop = await createDistributor();
    const size = await createCylinderType();
    const cylinder = await createCylinder({ distributor: shop, cylinderTypeId: size.id });
    expect(cylinder).toMatchObject({ state: CylinderState.FULL, custodyType: CustodyType.STORE, custodyId: shop.homeStoreId });
    const price = await createZonePrice({ distributorId: shop.id, zoneId: shop.zone.id, basePaisa: 15_000n });
    expect(price).toMatchObject({ distributorId: shop.id, zoneId: shop.zone.id, basePaisa: 15_000n, note: null });
    await expect(
      createZonePrice({ distributorId: shop.id, zoneId: shop.zone.id, basePaisa: 1n }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('resetDb() empties every table and restores the seeded rows', async () => {
    await createDistributor({ balancePaisa: 1_000n });
    await createSuperAdmin();
    await createStore();
    await db().expenseType.update({ where: { code: 'PETROL' }, data: { name: 'Fuel', nameKey: 'fuel' } });
    await db().expenseType.create({ data: { name: 'Snacks', nameKey: 'snacks' } });

    await resetDb();

    const [users, stores, zones, ledger] = await Promise.all([
      db().user.count(),
      db().store.count(),
      db().zone.count(),
      db().ledgerEntry.count(),
    ]);
    expect([users, stores, zones, ledger]).toEqual([0, 0, 0, 0]);
    const types = await db().expenseType.findMany({ orderBy: { sortOrder: 'asc' } });
    expect(types.map((t) => [t.code, t.name])).toEqual(SEEDED_EXPENSE_TYPES.map((t) => [t.code, t.name]));
  });
});
