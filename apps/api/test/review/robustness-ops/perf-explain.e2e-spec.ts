/**
 * Review (robustness and operations): Inc 1 list and lookup queries on realistic row counts. Ahmed Gas
 * gets 5,000 orders (about four months of a busy shop), each delivered one with its trip, stops and four
 * cylinder events per cylinder (load, deliver, take back, hand back: about 54,000 events), its
 * DEBIT_ORDER ledger row and audit rows. Then the hot queries are EXPLAINed and the endpoints timed.
 *
 * Prints the plans and timings.
 *
 * Review finding robustness-ops-12 asked for indexes on cylinder_events(order_id) and (trip_id).
 * Verifier: REFUTED, documented plan. DATA_MODEL §4.2 (inc2_driver_flow) adds @@index([tripId]),
 * @@index([orderId]) and @@index([createdAt]) to CylinderEvent, so Inc 1 runs these lookups as
 * sequential scans by design; at this size they take milliseconds, with no pilot impact (2 distributors).
 * The plan checks therefore pin what matters for Inc 1: each hot lookup stays well under PLAN_BUDGET_MS
 * at about 54,000 events. Once inc2 adds the indexes, they can assert index use again.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { authHeader, createStandardData, describeDb, getTestPrisma, type StandardData } from '../../helpers';
import { http } from '../../helpers/http';

const ORDERS = 5_000;
/** What a hot lookup may take at this size without an index (the review measured about 9 ms). */
const PLAN_BUDGET_MS = 250;

/** The "Execution Time: 8.123 ms" line of an EXPLAIN ANALYZE plan, in milliseconds. */
function executionMs(text: string): number {
  const m = /Execution Time: ([\d.]+) ms/.exec(text);
  if (!m) throw new Error(`no execution time in the plan:\n${text}`);
  return Number(m[1]);
}

interface PlanRow {
  'QUERY PLAN': string;
}

describeDb('review robustness: Inc 1 queries at 5,000 orders', () => {
  let app: INestApplication;
  let std: StandardData;

  beforeAll(async () => {
    app = await createTestApp();
    std = await createStandardData({ cylinders: true });
    const db = getTestPrisma();
    const da = std.DA.id;
    const dr = std.DR1;
    const zone = std.zones.North.id;
    // Trips: one per 5 orders, all completed by DR1 from Ahmed Gas Store.
    await db.$executeRawUnsafe(`
      INSERT INTO trips (id, driver_id, vehicle_id, origin_store_id, status, planned_at, started_at, completed_at)
      SELECT gen_random_uuid(), '${dr.id}', '${dr.vehicleId}', '${std.DA.homeStoreId}', 'COMPLETED',
             now() - (g || ' hours')::interval, now() - (g || ' hours')::interval, now() - (g || ' hours')::interval
      FROM generate_series(1, ${ORDERS / 5}) g`);
    // Orders: 90 % delivered over ~4 months, the rest cancelled, failed or open.
    await db.$executeRawUnsafe(`
      WITH t AS (SELECT id, row_number() OVER (ORDER BY planned_at) AS rn FROM trips)
      INSERT INTO orders (id, distributor_id, client_id, delivery_address, delivery_address_label, dest_zone_id, origin_store_id,
                          order_no, status, payment_status, delivery_fee_paisa, fee_status, fee_strategy, fee_base_paisa,
                          trip_id, assigned_at, load_started_at, delivered_at, cancelled_at, failed_at, created_at, updated_at)
      SELECT gen_random_uuid(), '${da}', '${std.C1.id}', ST_SetSRID(ST_MakePoint(74.23, 31.53), 4326), 'Sana''s house', '${zone}',
             '${std.DA.homeStoreId}', 1000 + g,
             (CASE WHEN g % 10 < 9 THEN 'DELIVERED' WHEN g % 20 = 9 THEN 'CANCELLED' WHEN g % 40 = 19 THEN 'FAILED' ELSE 'PENDING' END)::"OrderStatus",
             'PAID_VIA_LEDGER', 48000, 'DEDUCTED', 'DISTRIBUTOR_ZONE', 25000,
             CASE WHEN g % 10 < 9 THEN (SELECT id FROM t WHERE t.rn = 1 + (g % ${ORDERS / 5})) END,
             now() - (g * 30 || ' minutes')::interval,
             CASE WHEN g % 10 < 9 THEN now() - (g * 30 || ' minutes')::interval END,
             CASE WHEN g % 10 < 9 THEN now() - (g * 30 - 20 || ' minutes')::interval END,
             CASE WHEN g % 20 = 9 THEN now() - (g * 30 || ' minutes')::interval END,
             CASE WHEN g % 40 = 19 THEN now() - (g * 30 || ' minutes')::interval END,
             now() - (g * 30 + 60 || ' minutes')::interval, now()
      FROM generate_series(1, ${ORDERS}) g`);
    await db.$executeRawUnsafe(`UPDATE distributors SET next_order_no = 1000 + ${ORDERS} + 1 WHERE id = '${da}'`);
    await db.$executeRawUnsafe(`
      INSERT INTO order_lines (id, order_id, cylinder_type_id, full_count, expected_return_count)
      SELECT gen_random_uuid(), o.id, '${std.sizes.kg11_8}', 3, 3 FROM orders o WHERE o.distributor_id = '${da}'`);
    // Stops: the store stop of each trip and one delivery stop per delivered order.
    await db.$executeRawUnsafe(`
      INSERT INTO trip_stops (id, trip_id, store_id, seq, stop_type, status, location, arrived_at, departed_at)
      SELECT gen_random_uuid(), t.id, '${std.DA.homeStoreId}', 0, 'STORE_PICKUP', 'DONE', ST_SetSRID(ST_MakePoint(74.22, 31.52), 4326), t.started_at, t.started_at
      FROM trips t`);
    await db.$executeRawUnsafe(`
      INSERT INTO trip_stops (id, trip_id, order_id, seq, stop_type, status, location, arrived_at, departed_at)
      SELECT gen_random_uuid(), o.trip_id, o.id, row_number() OVER (PARTITION BY o.trip_id ORDER BY o.id), 'DELIVERY', 'DONE',
             ST_SetSRID(ST_MakePoint(74.23, 31.53), 4326), o.delivered_at, o.delivered_at
      FROM orders o WHERE o.trip_id IS NOT NULL`);
    // Cylinder events: 3 cylinders x 4 moves per delivered order.
    await db.$executeRawUnsafe(`
      WITH c AS (SELECT id, row_number() OVER (ORDER BY serial) AS rn FROM cylinders WHERE distributor_id = '${da}'),
           o AS (SELECT id, trip_id, delivered_at, row_number() OVER (ORDER BY id) AS rn FROM orders WHERE trip_id IS NOT NULL)
      INSERT INTO cylinder_events (id, cylinder_id, event_type, actor_user_id, trip_id, order_id, created_at)
      SELECT gen_random_uuid(), (SELECT c.id FROM c WHERE c.rn = 1 + ((o.rn * 3 + k) % 35)), e.t::"CylinderEventType", '${dr.userId}',
             o.trip_id, CASE WHEN e.t IN ('DELIVERED', 'PICKED_UP_EMPTY') THEN o.id END, o.delivered_at
      FROM o, generate_series(0, 2) k, (VALUES ('SCAN_OUT'), ('DELIVERED'), ('PICKED_UP_EMPTY'), ('SCAN_IN')) e(t)`);
    // Money: one top-up covering everything, then a DEBIT_ORDER per order; the balance stays equal to the ledger.
    await db.$executeRawUnsafe(`
      INSERT INTO ledger_entries (id, distributor_id, entry_type, amount_paisa, balance_after_paisa, idempotency_key, order_id, created_at)
      SELECT gen_random_uuid(), '${da}', 'DEBIT_ORDER', -48000, 0, 'order:' || o.id || ':debit', o.id, o.created_at
      FROM orders o WHERE o.distributor_id = '${da}'`);
    await db.$executeRawUnsafe(`
      INSERT INTO ledger_entries (id, distributor_id, entry_type, amount_paisa, balance_after_paisa, idempotency_key, reason_code, created_at)
      VALUES (gen_random_uuid(), '${da}', 'ADJUSTMENT', ${ORDERS * 48000}, 0, 'perf:${da}', 'OPENING_BALANCE', now() - interval '200 days')`);
    await db.$executeRawUnsafe(`
      INSERT INTO audit_logs (id, actor_kind, actor_user_id, action, resource_type, resource_id, distributor_id, created_at)
      SELECT gen_random_uuid(), 'USER', '${std.DA.userId}', 'order.create', 'order', o.id, '${da}', o.created_at
      FROM orders o WHERE o.distributor_id = '${da}'`);
    await db.$executeRawUnsafe('ANALYZE');
  }, 300_000);

  afterAll(async () => {
    await app.close();
  });

  async function plan(sql: string): Promise<string> {
    const rows = await getTestPrisma().$queryRawUnsafe<PlanRow[]>(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
    return rows.map((row) => row['QUERY PLAN']).join('\n');
  }

  it('prints the counts', async () => {
    const db = getTestPrisma();
    const counts = {
      orders: await db.order.count(),
      events: await db.cylinderEvent.count(),
      stops: await db.tripStop.count(),
      ledger: await db.ledgerEntry.count(),
      audit: await db.auditLog.count(),
    };
    // eslint-disable-next-line no-console
    console.log('[perf] rows', counts);
    expect(counts.orders).toBeGreaterThanOrEqual(ORDERS);
  });

  it('REFUTED robustness-ops-12 the order views look up handovers by order id in milliseconds (every GET /orders, /orders/:id, board page)', async () => {
    const ids = await getTestPrisma().order.findMany({ where: { distributorId: std.DA.id }, orderBy: { createdAt: 'desc' }, take: 31, select: { id: true } });
    const list = ids.map((row) => `'${row.id}'`).join(',');
    const text = await plan(`SELECT order_id FROM cylinder_events WHERE order_id IN (${list}) AND event_type = 'DELIVERED'`);
    // eslint-disable-next-line no-console
    console.log(`[perf] handovers for one page of orders:\n${text}`);
    expect(executionMs(text)).toBeLessThan(PLAN_BUDGET_MS);
  });

  it('REFUTED robustness-ops-12 the trip event checks look up a trip in milliseconds (assign, reassign, trip abort, GET /trips/:id)', async () => {
    const trip = await getTestPrisma().trip.create({
      data: { driverId: std.DR1.id, vehicleId: std.DR1.vehicleId as string, originStoreId: std.DA.homeStoreId },
    });
    const text = await plan(`SELECT EXISTS (SELECT 1 FROM cylinder_events WHERE trip_id = '${trip.id}'::uuid) AS found`);
    // eslint-disable-next-line no-console
    console.log(`[perf] tripHasScans on a new trip:\n${text}`);
    expect(executionMs(text)).toBeLessThan(PLAN_BUDGET_MS);
    // The load-or-hand-over check of assign rule 4 and the cancel's trip abort (contract-compat-02).
    const loaded = await plan(`SELECT EXISTS (SELECT 1 FROM cylinder_events WHERE trip_id = '${trip.id}'::uuid AND event_type <> 'SCAN_IN') AS found`);
    // eslint-disable-next-line no-console
    console.log(`[perf] tripHasLoadOrHandover on a new trip:\n${loaded}`);
    expect(executionMs(loaded)).toBeLessThan(PLAN_BUDGET_MS);
  });

  it('times the Inc 1 endpoints a shop and the office poll', async () => {
    const api = http(app);
    const DA = authHeader(std.DA.actor);
    const SA = authHeader(std.SA1.actor);
    const order = await getTestPrisma().order.findFirstOrThrow({ where: { distributorId: std.DA.id, status: 'DELIVERED' }, orderBy: { createdAt: 'desc' } });
    const calls: Array<[string, () => PromiseLike<{ status: number }>]> = [
      ['GET /orders (bare, 100)', () => api.get('/api/v1/orders').set(DA)],
      ['GET /orders?tab=done', () => api.get('/api/v1/orders?tab=done').set(DA)],
      ['GET /orders?tab=active', () => api.get('/api/v1/orders?tab=active').set(DA)],
      ['GET /orders/:id', () => api.get(`/api/v1/orders/${order.id}`).set(DA)],
      ['GET /distributor/home', () => api.get('/api/v1/distributor/home').set(DA)],
      ['GET /wallet/statement', () => api.get('/api/v1/wallet/statement').set(DA)],
      ['GET /ledger/me', () => api.get('/api/v1/ledger/me').set(DA)],
      ['GET /orders/board?tab=all', () => api.get('/api/v1/orders/board?tab=all').set(SA)],
      ['GET /orders/board?tab=needs-driver', () => api.get('/api/v1/orders/board?tab=needs-driver').set(SA)],
      ['GET /admin/summary', () => api.get('/api/v1/admin/summary').set(SA)],
      ['GET /admin/wallets', () => api.get('/api/v1/admin/wallets').set(SA)],
      ['GET /audit-logs?resourceType=order', () => api.get('/api/v1/audit-logs?resourceType=order').set(SA)],
      ['GET /orders/all (legacy)', () => api.get('/api/v1/orders/all').set(SA)],
    ];
    const timings: Record<string, string> = {};
    for (const [name, call] of calls) {
      await call();
      const started = process.hrtime.bigint();
      const res = await call();
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      timings[name] = `${res.status} in ${ms.toFixed(0)} ms`;
    }
    const all = await api.get('/api/v1/orders/all').set(SA);
    timings['GET /orders/all rows'] = String(Array.isArray(all.body) ? all.body.length : 'n/a');
    timings['GET /orders/all bytes'] = String(all.text.length);
    // eslint-disable-next-line no-console
    console.log('[perf] endpoint timings', timings);
    expect(Object.keys(timings).length).toBeGreaterThan(0);
  }, 120_000);
});
