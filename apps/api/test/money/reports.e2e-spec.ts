/**
 * Office reports (API_CONTRACT §7.13): kept, office only, money read from the ledger, deliveries counted
 * by when they were delivered, and only safe user fields.
 */
import type { INestApplication } from '@nestjs/common';
import { userActor } from '../../src/common/auth/actor';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http as client } from '../helpers/http';
import { createStandardData, type StandardData } from '../helpers/standard-data';
import { insertOrder } from './money-fixtures';

describeDb('money: office reports', () => {
  let app: INestApplication;
  let std: StandardData;
  const db = () => getTestPrisma();
  const http = () => client(app);

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    app.get(SettingsService).invalidate();
    std = await createStandardData();
  });

  afterAll(async () => {
    await app?.close();
  });

  const office = () => authHeader(std.SA1.actor);

  async function charged(zoneId: string, amountPaisa: bigint, client = std.C1) {
    const order = await insertOrder({ distributor: std.DA, client, zoneId, feePaisa: amountPaisa });
    await db().$transaction((tx) =>
      app.get(WalletService).debit(tx, {
        distributorId: std.DA.id,
        subject: { type: 'ORDER', orderId: order.id },
        amountPaisa,
        actor: userActor(std.DA.actor),
      }),
    );
    return order.id;
  }

  it('orders by zone: revenue is the delivery costs taken from the ledger, net of costs returned', async () => {
    await charged(std.zones.North.id, 48_000n);
    const returned = await charged(std.zones.South.id, 40_000n, std.C2);
    await db().$transaction((tx) =>
      app.get(WalletService).reverse(tx, { subject: { type: 'ORDER', orderId: returned }, actor: userActor(std.DA.actor), reason: 'Cancelled' }),
    );
    // An order whose fee column says Rs 999 but which never moved money counts for nothing.
    await insertOrder({ distributor: std.DA, client: std.C2, zoneId: std.zones.South.id, feePaisa: 99_900n });
    const res = await http().get(`/api/v1/reports/orders-by-zone/${std.zones.North.cityId}`).set(office()).expect(200);
    const byName = new Map((res.body as Array<{ name: string; order_count: number; revenue_paisa: string }>).map((row) => [row.name, row]));
    expect(byName.get('North')).toMatchObject({ order_count: 1, revenue_paisa: '48000' });
    expect(byName.get('South')).toMatchObject({ order_count: 2, revenue_paisa: '0' });
    expect(byName.get('East')).toMatchObject({ order_count: 0, revenue_paisa: '0' });
  });

  it('driver performance counts deliveries by when they were delivered (deliveredAt)', async () => {
    const trip = await db().trip.create({
      data: { driverId: std.DR1.id, vehicleId: std.DR1.vehicleId as string, originStoreId: std.DA.homeStoreId, status: 'COMPLETED' },
    });
    const now = Date.now();
    const recent = await insertOrder({ distributor: std.DA, client: std.C1, zoneId: std.zones.North.id, status: 'DELIVERED', deliveredAt: new Date(now - 3600_000) });
    const old = await insertOrder({ distributor: std.DA, client: std.C1, zoneId: std.zones.North.id, status: 'DELIVERED', deliveredAt: new Date(now - 3 * 24 * 3600_000) });
    await db().order.updateMany({ where: { id: { in: [recent.id, old.id] } }, data: { tripId: trip.id } });
    const since = new Date(now - 24 * 3600_000).toISOString();
    const res = await http().get('/api/v1/reports/driver-performance').query({ since }).set(office()).expect(200);
    const kashif = (res.body as Array<{ driverId: string; deliveredOrders: number; name: string }>).find((row) => row.driverId === std.DR1.id);
    expect(kashif).toMatchObject({ name: 'Kashif', deliveredOrders: 1 });
  });

  it('reports are office only, refuse a bad date, and never carry secrets', async () => {
    for (const who of [authHeader(std.DA.actor), authHeader(std.DR1.actor)]) {
      await http().get('/api/v1/reports/delivery-funnel').set(who).expect(403);
    }
    await http().get('/api/v1/reports/delivery-funnel').query({ since: 'garbage' }).set(office()).expect(400);
    await http().get('/api/v1/reports/orders-by-zone/not-a-uuid').set(office()).expect(404);
    for (const url of [
      '/api/v1/reports/driver-utilization',
      '/api/v1/reports/driver-attendance',
      '/api/v1/reports/dispatch-decisions',
      '/api/v1/reports/delivery-funnel',
      '/api/v1/reports/fuel-consumption',
      '/api/v1/reports/driver-performance',
    ]) {
      const res = await http().get(url).query({ since: '2026-01-01' }).set(office()).expect(200);
      expect({ url, leaked: /passwordHash|cnic|tokenHash|codeHash/.test(JSON.stringify(res.body)) }).toEqual({ url, leaked: false });
    }
  });
});
