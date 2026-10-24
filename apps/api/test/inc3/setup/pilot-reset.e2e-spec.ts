/**
 * The pilot reset CLI (API_CONTRACT §10.3, settled point G10-02): SET-009, SET-010 and SET-011, plus the
 * structural check that the reset's map of "what hangs off what" covers every foreign key of the schema.
 *
 * No HTTP: each case runs the CLI's entry point (`runPilotResetCli`, what `npm run pilot:reset` calls)
 * against this suite's test database, after the setup CLI loaded the standard data with `--test` and a
 * day of activity ran on it; a non-test shop, Live Gas, lives next to it.
 */
import { randomUUID } from 'crypto';
import * as path from 'path';
import type { INestApplication } from '@nestjs/common';
import { CylinderState, DayClosePlace, OrderStatus, StoredFilePurpose, UserRole } from '@prisma/client';
import {
  DELETE_ORDER,
  NEVER_DELETED,
  OWNED_BY,
  ABOUT_DELETED,
  POINTS_AT,
} from '../../../src/modules/pilot-setup/reset/reset-graph';
import { createTestApp, forgetSettings } from '../../helpers/app';
import { authHeader } from '../../helpers/auth';
import { createConfirmation } from '../../helpers/customer-links';
import { createDayClose, createStoredFile, addDayCloseLines } from '../../helpers/day-end';
import { getTestPrisma, resetDb, walletMismatches, SCHEMA_PATH } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { createClient, createDistributor, createDriver, createZone, type TestDistributor } from '../../helpers/factories';
import { http } from '../../helpers/http';
import { createScratchDb, disconnectAdmin, prismaOk, tableDigest, type ScratchDb } from '../../helpers/migrations';
import { createRefill, pickUpForRefill } from '../../helpers/refills';
import { createOrder, createTrip, handOver, loadVan, registerCylinders } from '../../helpers/runs';
import { scanCalls } from '../../helpers/scan-calls';
import { login, useMemoryRateLimits } from '../../security/security-helpers';
import { PHONES, SAMPLE_FILE, printedPasswords, removeScratchDir, runReset, runSetup, scratchDir, setupPeople, tableCounts, x1Body, type SetupPeople } from './support';

jest.setTimeout(300_000);

const API = '/api/v1';
const NOTHING_DELETED = 'Nothing deleted. Run again with --yes to delete.';

describeDb('pilot reset CLI (SET-009 to SET-011)', () => {
  let app: INestApplication;
  const db = () => getTestPrisma();
  const api = () => http(app);
  const dir = scratchDir('pilot-reset');
  let labelsCount = 0;

  interface World {
    people: SetupPeople;
    passwords: Map<string, { role: string; phone: string; password: string }>;
    /** Every id of a row the reset must delete that the cases name (orders, payments, trips, …). */
    testIds: string[];
    live: { shop: TestDistributor; driverUserId: string; driverId: string; vehicleId: string | null; clientId: string };
  }

  /**
   * The precondition of SET-009: setup with --test, a day of activity on the test data (a top-up, an
   * order on a run with load scans, a refill with pickups, a day-end with its sheet, a case, a delivered
   * order with its confirmation and SMS row, push and refresh tokens, an expense on a test van), and a
   * non-test shop "Live Gas" (LG) with its own store, customer, driver and van, cylinders, an order and
   * ledger rows.
   */
  async function world(): Promise<World> {
    const setup = await runSetup(['--file', SAMPLE_FILE, '--test', '--labels', path.join(dir, `labels-${++labelsCount}.csv`)]);
    expect(setup.code).toBe(0);
    forgetSettings(app);
    const passwords = printedPasswords(setup);
    const people = await setupPeople();
    const cylinder = async (shortNo: number) =>
      db().cylinder.findFirstOrThrow({ where: { distributorId: people.DA.distributorId, shortNo }, select: { id: true, qrCode: true } });
    const testIds: string[] = [];

    // A top-up, approved against the bank: AG-T001.
    const topup = await api()
      .post(`${API}/payments/topup-requests`)
      .set(authHeader(people.DA))
      .set('Idempotency-Key', randomUUID())
      .send({ amountPaisa: 200000, payerName: 'Ahmed Gas', payerChannel: 'BANK_APP', transactionId: 'TX-1001' })
      .expect(201);
    await api()
      .post(`${API}/payments/${topup.body.id}/approve`)
      .set(authHeader(people.SA1))
      .send({ bankReference: 'BANKREF1001', bankAmountPaisa: 200000, bankTime: new Date(Date.now() - 60_000).toISOString() })
      .expect(200);
    testIds.push(topup.body.id);

    // X1 for Sana, on Kashif's run, three cylinders loaded at Ahmed Gas Store.
    const x1 = await api().post(`${API}/orders`).set(authHeader(people.DA)).set('Idempotency-Key', randomUUID()).send(x1Body(people)).expect(201);
    const assigned = await api().post(`${API}/orders/${x1.body.id}/assign-driver`).set(authHeader(people.SA1)).send({ driverId: people.DR1.driverId }).expect(200);
    const pickup = await db().tripStop.findFirstOrThrow({ where: { tripId: assigned.body.tripId, stopType: 'STORE_PICKUP' }, select: { id: true } });
    const scans = scanCalls(app);
    for (const shortNo of [1, 2, 31]) {
      const { qrCode } = await cylinder(shortNo);
      await scans.tripScan(people.DR1, assigned.body.tripId, { stopId: pickup.id, action: 'LOAD', code: qrCode }).expect(201);
    }
    testIds.push(x1.body.id, assigned.body.tripId, pickup.id);

    // A refill (AG-R001) for Imran: two empty 15 kg cylinders picked up.
    const station = await db().fillingStation.findFirstOrThrow({ where: { name: 'Lahore Filling Station' }, select: { id: true } });
    const empties = [await cylinder(21), await cylinder(22)];
    for (const empty of empties) await db().cylinder.update({ where: { id: empty.id }, data: { state: CylinderState.EMPTY } });
    const refill = await createRefill({
      distributor: { id: people.DA.distributorId, code: 'AG', homeStoreId: people.DA.homeStoreId },
      cylinderTypeId: people.sizes.kg15,
      requestedCount: 2,
      station,
      assignTo: { id: people.DR2.driverId, vehicleId: people.DR2.vehicleId },
    });
    await pickUpForRefill({ refill, driver: { userId: people.DR2.userId }, cylinders: empties });
    testIds.push(refill.id);

    // The 2026-10-21 day-end with its sheet file and one line.
    const sheet = await createStoredFile({ purpose: StoredFilePurpose.DAY_END_SHEET, uploadedBy: { userId: people.DA.userId }, distributorId: people.DA.distributorId });
    const day = await createDayClose({ distributor: { id: people.DA.distributorId }, businessDate: '2026-10-21', sheetFileId: sheet.id, sheetSnapshotAt: new Date() });
    const c5 = await cylinder(5);
    await addDayCloseLines(day.id, [
      { cylinderId: c5.id, sheetKey: 'AG-C0005', cylinderTypeId: people.sizes.kg11_8, systemPlace: DayClosePlace.STORE, systemState: CylinderState.FULL },
    ]);
    testIds.push(day.id, sheet.id);

    // A case about X1, the drivers' push tokens and an expense on Kashif's van.
    const alert = await db().alert.create({
      data: { alertType: 'CUSTOMER_PROBLEM', title: 'Customer problem', body: 'Sana: one cylinder missing', resourceType: 'Order', resourceId: x1.body.id, distributorId: people.DA.distributorId },
    });
    await db().expoPushToken.create({ data: { userId: people.DR1.userId, token: `ExponentPushToken[${randomUUID()}]`, platform: 'android' } });
    const petrol = await db().expenseType.findUniqueOrThrow({ where: { code: 'PETROL' }, select: { id: true } });
    const expense = await db().expense.create({
      data: {
        typeId: petrol.id,
        description: 'Fuel for LEA-101',
        amountPaisa: 150000n,
        expenseDate: new Date('2026-10-21T00:00:00.000Z'),
        vehicleId: people.DR1.vehicleId,
        driverId: people.DR1.driverId,
        recordedByUserId: people.SA1.userId,
      },
      select: { id: true },
    });
    testIds.push(alert.id, expense.id);

    // Bilal Gas delivered an order to Hina: its confirmation and the SMS row.
    const hina = await db().client.findUniqueOrThrow({ where: { id: people.C3.id }, select: { id: true } });
    const delivered = await createOrder({
      distributor: { id: people.DB.distributorId, code: 'BG', homeStoreId: people.DB.homeStoreId },
      client: { id: hina.id, location: { lat: 31.51, lng: 74.28 }, zoneId: people.zones.South },
      lines: [{ cylinderTypeId: people.sizes.kg11_8, fullCount: 1 }],
      status: OrderStatus.DELIVERED,
    });
    const confirmation = await createConfirmation({ order: delivered });
    await db().outboundMessage.create({
      data: {
        channel: 'SMS',
        provider: 'mock',
        toPhoneE164: PHONES.C3,
        templateKey: 'sms.deliveryConfirm.v1',
        bodyRedacted: 'Bilal Gas delivered BG-0001. Tell us if all is OK: [link]',
        status: 'SKIPPED',
        idempotencyKey: `confirm:${delivered.id}:v1:sms`,
        confirmationId: confirmation.id,
        tokenVersion: 1,
        orderId: delivered.id,
        distributorId: people.DB.distributorId,
      },
    });
    testIds.push(delivered.id, confirmation.id);

    // Sign-ins leave refresh tokens for the shop and the driver.
    await login(app, PHONES.DA, passwords.get('Ahmed Gas')?.password as string, 'distributor').expect(200);
    await login(app, PHONES.DR1, passwords.get('Kashif')?.password as string, 'driver').expect(200);
    testIds.push(people.DA.distributorId, people.DB.distributorId, people.DA.userId, people.DB.userId, people.DR1.userId, people.DR2.userId);

    // Live Gas: a non-test shop with its own store, customer, driver and van, cylinders, an order and ledger rows.
    const liveCity = await db().city.create({ data: { name: 'Multan' } });
    const liveZone = await createZone({ city: liveCity, name: 'Live Gas zone', bbox: [71.4, 30.1, 71.45, 30.15] });
    const shop = await createDistributor({ code: 'LG', businessName: 'Live Gas', balancePaisa: 300_000n, zone: liveZone });
    const client = await createClient({ distributor: shop, name: 'Live customer' });
    const driver = await createDriver({ zone: liveZone });
    await registerCylinders({ distributor: shop, cylinderTypeId: people.sizes.kg11_8, count: 2, actor: { userId: people.SA1.userId } });
    await createOrder({ distributor: shop, client, lines: [{ cylinderTypeId: people.sizes.kg11_8, fullCount: 1 }], feePaisa: 20_000n });
    return { people, passwords, testIds, live: { shop, driverUserId: driver.userId, driverId: driver.id, vehicleId: driver.vehicleId, clientId: client.id } };
  }

  /** Every row of Live Gas, its customer, its driver and van, as text: the reset must leave it identical. */
  async function liveRows(live: World['live']): Promise<string> {
    const id = live.shop.id;
    return JSON.stringify(
      {
        distributor: await db().distributor.findUnique({ where: { id } }),
        users: await db().user.findMany({ where: { id: { in: [live.shop.userId, live.driverUserId] } }, orderBy: { id: 'asc' } }),
        store: await db().$queryRaw`SELECT id, name, address, zone_id, ST_AsText(location) AS location FROM stores WHERE id = ${live.shop.homeStoreId}::uuid`,
        clients: await db().client.findMany({ where: { distributorId: id }, orderBy: { id: 'asc' } }),
        addresses: await db().$queryRaw`SELECT a.id, a.label, ST_AsText(a.location) AS location FROM client_addresses a JOIN clients c ON c.id = a.client_id WHERE c.distributor_id = ${id}::uuid ORDER BY a.id`,
        orders: await db().order.findMany({ where: { distributorId: id }, include: { lines: true }, orderBy: { id: 'asc' } }),
        ledger: await db().ledgerEntry.findMany({ where: { distributorId: id }, orderBy: { id: 'asc' } }),
        cylinders: await db().cylinder.findMany({ where: { distributorId: id }, include: { events: true }, orderBy: { id: 'asc' } }),
        driver: await db().driver.findUnique({ where: { id: live.driverId } }),
        vehicle: live.vehicleId ? await db().vehicle.findUnique({ where: { id: live.vehicleId } }) : null,
      },
      (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
    );
  }

  /** The shared set-up the reset keeps: zones, cities, cylinder types, stations and settings. */
  async function sharedDigest(): Promise<Record<string, { rows: number; md5: string }>> {
    const out: Record<string, { rows: number; md5: string }> = {};
    for (const table of ['zones', 'cities', 'cylinder_types', 'filling_stations', 'app_settings']) out[table] = await tableDigest(db(), table);
    return out;
  }

  beforeAll(async () => {
    app = await createTestApp();
    useMemoryRateLimits(app);
  }, 300_000);

  beforeEach(async () => {
    await resetDb();
    forgetSettings(app);
  });

  afterAll(async () => {
    await app?.close();
    removeScratchDir(dir);
    await disconnectAdmin();
  });

  it('SET-009 the reset deletes only test rows and what hangs off them', async () => {
    const { people, passwords, testIds, live } = await world();
    const liveBefore = await liveRows(live);
    const sharedBefore = await sharedDigest();
    const before = await tableCounts();
    expect(before.payments).toBe(1);
    expect(before.trips).toBe(1);
    expect(before.filling_orders).toBe(1);
    expect(before.day_closes).toBe(1);
    expect(before.delivery_confirmations).toBe(1);
    expect(before.outbound_messages).toBe(1);

    // Step 1.
    const run = await runReset(['--yes']);
    expect({ code: run.code, text: run.text }).toEqual({ code: 0, text: expect.stringContaining('Deleted ') });
    expect(run.text).toContain('Audit row pilot.reset written (actor SYSTEM cli:pilot-reset).');

    // Step 2: nothing of the test data is left, Live Gas is as it was and adds up.
    const after = await tableCounts();
    expect(await db().distributor.findMany({ select: { code: true } })).toEqual([{ code: 'LG' }]);
    for (const table of [
      'payments',
      'trips',
      'trip_stops',
      'filling_orders',
      'filling_order_cylinders',
      'day_closes',
      'day_close_lines',
      'stored_files',
      'alerts',
      'expo_push_tokens',
      'expenses',
      'delivery_confirmations',
      'outbound_messages',
      'stop_cylinders',
      'distributor_zone_prices',
      'distributor_zone_price_sizes',
    ]) {
      expect({ table, rows: after[table] }).toEqual({ table, rows: 0 });
    }
    expect(after.clients).toBe(1);
    expect(after.orders).toBe(1);
    expect(after.cylinders).toBe(2);
    expect(after.cylinder_events).toBe(2);
    expect(after.drivers).toBe(1);
    expect(after.vehicles).toBe(1);
    expect(after.stores).toBe(1);
    const users = await db().user.findMany({ select: { phone: true, role: true }, orderBy: { phone: 'asc' } });
    expect(users.filter((user) => user.role === UserRole.SUPER_ADMIN).map((user) => user.phone)).toEqual([PHONES.SA1, PHONES.SA2]);
    expect(users).toHaveLength(4);
    expect(await db().user.count({ where: { isTest: true } })).toBe(0);
    expect(await db().vehicle.count({ where: { isTest: true } })).toBe(0);
    const leftovers = await db().$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM audit_logs
      WHERE action <> 'pilot.reset'
        AND (resource_id = ANY(${testIds}::uuid[]) OR distributor_id = ANY(${testIds}::uuid[]) OR actor_user_id = ANY(${testIds}::uuid[]))`;
    expect(leftovers[0].n).toBe(0);
    expect(await liveRows(live)).toBe(liveBefore);
    expect(await walletMismatches()).toEqual([]);
    // Owner and Ops remain and can sign in.
    const owner = await login(app, PHONES.SA1, passwords.get('Owner')?.password as string, 'admin-web').expect(200);
    await login(app, PHONES.SA2, passwords.get('Ops')?.password as string, 'admin-web').expect(200);
    const wallet = await api().get(`${API}/admin/distributors/${live.shop.id}/wallet`).set({ Authorization: `Bearer ${owner.body.accessToken}` }).expect(200);
    expect(wallet.body).toMatchObject({ balancePaisa: '280000', integrity: { ok: true, ledgerSumPaisa: '280000', differencePaisa: '0' } });

    // Step 3: the shared set-up is unchanged.
    expect(await sharedDigest()).toEqual(sharedBefore);

    // Step 4: one pilot.reset row with the rows deleted per table.
    const audit = await api().get(`${API}/audit-logs`).query({ action: 'pilot.reset' }).set(authHeader(people.SA1)).expect(200);
    expect(audit.body.items).toHaveLength(1);
    expect(audit.body.items[0].actor).toEqual({ kind: 'SYSTEM', label: 'cli:pilot-reset' });
    const row = await db().auditLog.findFirstOrThrow({ where: { action: 'pilot.reset' } });
    const diff = row.diff as { deleted: Record<string, number>; total: number };
    for (const table of Object.keys(before)) {
      const gone = before[table] - after[table] + (table === 'audit_logs' ? 1 : 0);
      expect({ table, deleted: diff.deleted[table] ?? 0 }).toEqual({ table, deleted: gone });
    }
    expect(diff.total).toBe(Object.values(diff.deleted).reduce((sum, n) => sum + n, 0));

    // A second reset finds nothing and deletes nothing.
    const again = await runReset(['--yes']);
    expect(again.code).toBe(0);
    expect(again.text).toContain('no test data found');
  });

  it('SET-010 the reset refuses when a real record points at test data', async () => {
    const { people, live } = await world();
    // A Live Gas order delivered by the test driver Kashif on van LEA-101.
    const [cylinder] = await registerCylinders({ distributor: live.shop, cylinderTypeId: people.sizes.kg11_8, count: 1, actor: { userId: people.SA1.userId } });
    const client = await db().client.findFirstOrThrow({ where: { distributorId: live.shop.id }, select: { id: true } });
    const store = await db().$queryRaw<Array<{ lat: number; lng: number; zone_id: string }>>`
      SELECT ST_Y(location) AS lat, ST_X(location) AS lng, zone_id FROM stores WHERE id = ${live.shop.homeStoreId}::uuid`;
    const order = await createOrder({
      distributor: live.shop,
      client: { id: client.id, location: { lat: store[0].lat, lng: store[0].lng }, zoneId: store[0].zone_id },
      lines: [{ cylinderTypeId: people.sizes.kg11_8, fullCount: 1 }],
    });
    const trip = await createTrip({ driver: { id: people.DR1.driverId, vehicleId: people.DR1.vehicleId }, distributor: live.shop, orders: [order] });
    await loadVan({ trip, driver: { userId: people.DR1.userId }, cylinders: [cylinder], finishLoading: true });
    await handOver({ trip, order, driver: { userId: people.DR1.userId }, cylinders: [cylinder] });
    await db().order.update({
      where: { id: order.id },
      data: { status: OrderStatus.DELIVERED, deliveredAt: new Date(), deliveredByUserId: people.DR1.userId, deliveryMethod: 'SCANNED' },
    });
    const before = await tableCounts();

    // Step 1: refused, naming the Live Gas order (table, id and short number) and the test run it is on.
    const run = await runReset(['--yes']);
    expect(run.code).toBe(1);
    expect(run.text).toContain(
      `Refused: orders ${order.id} (${order.shortCode}) stays, but points at trips ${trip.id} (Kashif's run on LEA-101), which the reset would delete (orders.trip_id).`,
    );
    expect(order.shortCode).toBe('LG-0002');
    expect(run.lines[run.lines.length - 1]).toBe('Nothing deleted.');

    // Step 2: every count is as before.
    expect(await tableCounts()).toEqual(before);
    expect(await db().auditLog.count({ where: { action: 'pilot.reset' } })).toBe(0);
  });

  it('SET-011 the reset refuses to run on live, and needs --yes', async () => {
    const { live } = await world();
    const before = await tableCounts();

    // Step 1: --dry-run prints the plan with counts per table and deletes nothing.
    const dry = await runReset(['--dry-run']);
    expect(dry.code).toBe(0);
    expect(dry.lines[0]).toBe('Pilot reset plan: rows to delete per table (test shops, test logins, test vans and what hangs off them).');
    expect(dry.text).toMatch(/\n {2}distributors\s+2\n/);
    expect(dry.text).toMatch(/\n {2}cylinders\s+35\n/);
    expect(dry.text).toMatch(/\n {2}total\s+\d+\n/);
    expect(dry.text).toContain('Dry run: nothing deleted.');
    expect(await tableCounts()).toEqual(before);

    // Step 2: without --yes the plan prints, nothing is deleted, exit 1.
    const unconfirmed = await runReset([]);
    expect(unconfirmed.code).toBe(1);
    expect(unconfirmed.lines[0]).toBe(dry.lines[0]);
    expect(unconfirmed.lines[unconfirmed.lines.length - 1]).toBe(NOTHING_DELETED);
    expect(await tableCounts()).toEqual(before);

    // Step 3: production (NODE_ENV=production on its own counts) needs --allow-production --confirm-db.
    const production = { ...process.env, NODE_ENV: 'production', APP_ENV: '' };
    const refused = await runReset(['--yes'], { env: production });
    expect(refused.code).toBe(1);
    expect(refused.text).toContain('Refused: this is production');
    expect(refused.text).toContain('--allow-production --confirm-db <name>');
    expect(refused.text).toContain('Nothing deleted.');
    expect(await tableCounts()).toEqual(before);
    // APP_ENV=production with another NODE_ENV counts too.
    const appEnv = await runReset(['--yes'], { env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'production' } });
    expect(appEnv.code).toBe(1);
    expect(await tableCounts()).toEqual(before);

    // Step 4: a wrong database name is refused.
    const wrong = await runReset(['--yes', '--allow-production', '--confirm-db', 'wrong_name'], { env: production });
    expect(wrong.code).toBe(1);
    expect(wrong.text).toContain("Refused: --confirm-db wrong_name doesn't name this database. Nothing deleted.");
    expect(await tableCounts()).toEqual(before);
    expect(live.shop.code).toBe('LG');

    // Step 5: on a copy only (a scratch database with the same set-up), the confirmed run deletes there.
    const copy: ScratchDb = await createScratchDb('prodcopy');
    const mainUrl = process.env.DATABASE_URL;
    try {
      prismaOk(['migrate', 'deploy', '--schema', SCHEMA_PATH], copy.url);
      process.env.DATABASE_URL = copy.url;
      const copied = await runSetup(['--file', SAMPLE_FILE, '--test', '--labels', path.join(dir, `labels-${++labelsCount}.csv`)]);
      expect(copied.code).toBe(0);
      const ran = await runReset(['--yes', '--allow-production', '--confirm-db', copy.name], { env: production });
      expect({ code: ran.code, text: ran.text }).toEqual({ code: 0, text: expect.stringContaining('Audit row pilot.reset written') });
      expect(await copy.client().distributor.count()).toBe(0);
      expect(await copy.client().user.count({ where: { role: UserRole.SUPER_ADMIN } })).toBe(2);
    } finally {
      process.env.DATABASE_URL = mainUrl;
      await copy.drop();
    }
    // The real test database was never touched.
    expect(await tableCounts()).toEqual(before);
  });

  it('SET-009 the reset map covers every foreign key and deletes children before parents', async () => {
    const fks = await db().$queryRaw<Array<{ child: string; column: string; parent: string; rule: string }>>`
      SELECT tc.table_name AS child, kcu.column_name AS column, ccu.table_name AS parent, rc.delete_rule AS rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`;
    expect(fks.length).toBeGreaterThan(50);
    const never = new Set<string>(NEVER_DELETED);
    const order = DELETE_ORDER as readonly string[];
    const listed = new Set([...OWNED_BY, ...ABOUT_DELETED].map((edge) => `${edge.table}.${edge.column}`).concat(POINTS_AT.map((edge) => `${edge.table}.${edge.column}`)));
    const uncovered = fks
      .filter((fk) => !never.has(fk.parent))
      .filter((fk) => !listed.has(`${fk.child}.${fk.column}`))
      .map((fk) => `${fk.child}.${fk.column} -> ${fk.parent}`);
    expect(uncovered).toEqual([]);
    // Children first: a RESTRICT key's table is deleted before the table it points at.
    const misordered = fks
      .filter((fk) => fk.rule !== 'CASCADE' && fk.rule !== 'SET NULL' && order.includes(fk.child) && order.includes(fk.parent) && fk.child !== fk.parent)
      .filter((fk) => order.indexOf(fk.child) > order.indexOf(fk.parent))
      .map((fk) => `${fk.child} after ${fk.parent}`);
    expect(misordered).toEqual([]);
    // Every application table is either deleted from or kept on purpose.
    const tables = await db().$queryRaw<Array<{ name: string }>>`
      SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
    const unknown = tables.map((table) => table.name).filter((name) => !order.includes(name) && !never.has(name));
    expect(unknown).toEqual([]);
  });
});
