/**
 * Who may call what (API_CONTRACT §3.1, §3.2, §7.2): SEC-011, SEC-012, SEC-013 and SEC-014, across the
 * security, orders, money and expenses routes.
 */
import type { INestApplication } from '@nestjs/common';
import { systemActor } from '../../src/common/auth/actor';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http, type TestRequest } from '../helpers/http';
import { createStandardData, DUMMY_COMPANY_ACCOUNT, x1OrderBody, x2OrderBody, type StandardData } from '../helpers/standard-data';
import { APP_BOOT_TIMEOUT_MS, TEST_TIMEOUT_MS } from './security-helpers';

// Sign-ins hash with argon2 and the API boots once per suite: allow for a busy machine.
jest.setTimeout(TEST_TIMEOUT_MS);

type Call = [method: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, body?: Record<string, unknown>];

const KEY = (n: number) => `55555555-eeee-4eee-8eee-${String(n).padStart(12, '0')}`;

describeDb('roles and ownership', () => {
  let app: INestApplication;
  let std: StandardData;
  const db = () => getTestPrisma();

  function send(as: Record<string, string>, [method, url, body]: Call): TestRequest {
    const req = http(app)[method](`/api/v1${url}`).set(as);
    return body ? req.send(body) : req;
  }

  /** Every call answers 403 PERMISSION_DENIED "Your account can't do this." */
  async function expectDenied(as: Record<string, string>, calls: Call[]): Promise<void> {
    for (const call of calls) {
      const res = await send(as, call);
      expect({ call: `${call[0].toUpperCase()} ${call[1]}`, status: res.status, code: res.body.code }).toEqual({
        call: `${call[0].toUpperCase()} ${call[1]}`,
        status: 403,
        code: 'PERMISSION_DENIED',
      });
      expect(res.body.message).toBe("Your account can't do this.");
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
  }, APP_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    await resetDb();
    app.get(SettingsService).invalidate();
    std = await createStandardData({ cylinders: true });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('SEC-011 the super admin is refused on the routes only a driver may use (this lane)', async () => {
    const office = authHeader(std.SA1.actor);
    const before = await db().$queryRaw<Array<{ updated: Date | null }>>`
      SELECT current_location_updated_at AS updated FROM drivers WHERE id = ${std.DR1.id}::uuid`;
    await expectDenied(office, [
      ['patch', `/drivers/${std.DR1.id}/location`, { lat: 31.5, lng: 74.3 }],
      ['patch', `/drivers/${std.DR1.id}/online`, { isOnline: true }],
      ['post', '/reconciliations', { forDate: '2026-10-22', submittedCashPaisa: 0, cylindersDelivered: 0, cylindersReturned: 0 }],
      ['post', '/fuel-refills', { vehicleId: std.DR1.vehicleId, litres: 10, costPaisa: 300000, odometerKm: 10 }],
      ['get', '/fuel-refills/mine'],
    ]);
    const after = await db().$queryRaw<Array<{ updated: Date | null }>>`
      SELECT current_location_updated_at AS updated FROM drivers WHERE id = ${std.DR1.id}::uuid`;
    expect(after).toEqual(before);
    expect(await db().reconciliation.count()).toBe(0);
  });

  it('SEC-011 the super admin is refused on routes only the distributor or the driver may use', async () => {
    const office = authHeader(std.SA1.actor);
    const shop = authHeader(std.DA.actor);
    const x1 = await send(shop, ['post', '/orders', x1OrderBody(std)]).set('Idempotency-Key', KEY(1)).expect(201);
    await send(office, ['post', `/orders/${x1.body.id}/assign-driver`, { driverId: std.DR1.id }]).expect(200);
    const trip = await db().trip.findFirstOrThrow({ where: { driverId: std.DR1.id } });
    // Steps 1-2.
    await expectDenied(office, [
      ['post', '/orders', x2OrderBody(std)],
      ['post', '/orders/quote', x2OrderBody(std)],
      ['post', '/payments/topup-requests', { amountPaisa: 100000, payerName: 'Office', payerChannel: 'BANK_APP' }],
      ['post', '/clients', { name: 'Office Customer', phone: '0333 4445556' }],
      ['get', '/wallet'],
      ['get', '/wallet/statement'],
      ['get', '/ledger/balance'],
      ['get', '/distributor/home'],
      ['get', '/distributors/me'],
      ['post', '/filling-orders', { fillingStationId: std.DA.id, cylinderTypeId: std.sizes.kg11_8, requestedCount: 2 }],
      ['post', '/custody/scan', { qrCode: 'AG-C0001', eventType: 'SCAN_OUT', tripId: trip.id }],
      ['patch', `/drivers/${std.DR1.id}/location`, { lat: 31.5, lng: 74.3 }],
      ['get', '/trips/mine'],
    ]);
    // Step 3.
    const status = await send(office, ['patch', `/orders/${x1.body.id}/status`, { status: 'DELIVERED' }]).expect(400);
    expect(status.body).toMatchObject({ code: 'ORDER_USE_MANUAL_DELIVERY', message: 'Use "Mark delivered by office" for this.' });
    // Nothing changed.
    expect((await db().distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).advanceBalancePaisa).toBe(452_000n);
    expect(await db().order.count()).toBe(1);
    expect(await db().payment.count()).toBe(0);
    expect(await db().client.count({ where: { name: 'Office Customer' } })).toBe(0);
    expect(await db().fillingOrder.count()).toBe(0);
    expect(await db().cylinder.findFirstOrThrow({ where: { serial: 'AG-C0001' } })).toMatchObject({ custodyType: 'STORE', custodyId: std.DA.homeStoreId });
    expect((await db().order.findUniqueOrThrow({ where: { id: x1.body.id } })).status).toBe('ASSIGNED');
  });

  it('SEC-012 distributors and drivers are refused on the office routes of this lane, and on each other\'s', async () => {
    const officeOnly: Call[] = [
      ['get', '/users'],
      ['get', `/users/${std.DA.userId}`],
      ['patch', `/users/${std.DR2.userId}/status`, { value: 'SUSPENDED', reason: 'Role refusal test' }],
      ['patch', `/users/${std.DR2.userId}/role`, { value: 'DRIVER', reason: 'Role refusal test' }],
      ['post', `/users/${std.DR2.userId}/password`, { password: 'Refused#2026' }],
      ['get', '/drivers'],
      ['post', '/drivers', { name: 'Refused', phone: '0345 9990001', licenceNo: 'REFUSED-1' }],
      ['patch', `/drivers/${std.DR2.id}/vehicle`, { vehicleId: null }],
      ['patch', `/drivers/${std.DR2.id}/availability`, { availability: 'OFF_DUTY' }],
      ['delete', `/drivers/${std.DR2.id}`, { reason: 'Role refusal test' }],
      ['patch', `/drivers/${std.DR2.id}/reactivate`, { reason: 'Role refusal test' }],
      ['get', '/vehicles'],
      ['post', '/vehicles', { plateNo: 'REF-1', capacityUnits: 10, homeZoneId: std.zones.North.id }],
      ['get', '/alerts'],
      ['get', '/alerts/unread-count'],
      ['get', '/alert-rules'],
      ['post', '/alert-rules', { name: 'Low balance', ruleKind: 'DISTRIBUTOR_BALANCE_LOW', threshold: 100000 }],
      ['get', '/fuel-refills'],
      ['get', `/fuel-refills/vehicle/${std.DR1.vehicleId}`],
      ['get', `/fuel-refills/driver/${std.DR1.id}`],
      ['post', '/cities', { name: 'Refused City' }],
      ['post', '/cylinder-types', { code: 'REFUSED', name: 'Refused', weightKg: 1, capacityUnits: 1 }],
    ];
    // Step 1: the distributor, also on the driver's own routes.
    await expectDenied(authHeader(std.DA.actor), [
      ...officeOnly,
      ['patch', `/drivers/${std.DR1.id}/location`, { lat: 31.5, lng: 74.3 }],
      ['patch', `/drivers/${std.DR1.id}/online`, { isOnline: true }],
      ['get', `/drivers/${std.DR1.id}`],
      ['post', '/reconciliations', { forDate: '2026-10-22', submittedCashPaisa: 0, cylindersDelivered: 0, cylindersReturned: 0 }],
    ]);
    // Step 2: the driver.
    await expectDenied(authHeader(std.DR1.actor), officeOnly);
    // Nothing changed.
    expect((await db().user.findUniqueOrThrow({ where: { id: std.DR2.userId } })).status).toBe('ACTIVE');
    expect(await db().driver.count()).toBe(2);
    expect(await db().alertRule.count()).toBe(0);
  });

  it('SEC-012 distributors and drivers are refused on each other\'s routes and on office routes', async () => {
    const office = authHeader(std.SA1.actor);
    const shop = authHeader(std.DA.actor);
    const driver = authHeader(std.DR1.actor);
    await app.get(SettingsService).set('topup.account', DUMMY_COMPANY_ACCOUNT, systemActor('cli:settings'), 'Role test company account', {
      allowNotEditable: true,
    });
    const x1 = await send(shop, ['post', '/orders', x1OrderBody(std)]).set('Idempotency-Key', KEY(11)).expect(201);
    const topup = await send(shop, ['post', '/payments/topup-requests', { amountPaisa: 500000, payerName: 'Ahmed Gas', payerChannel: 'BANK_APP' }])
      .set('Idempotency-Key', KEY(12))
      .expect(201);
    // Step 1.
    await expectDenied(shop, [
      ['get', '/admin/wallets'],
      ['get', '/admin/summary'],
      ['get', '/orders/board'],
      ['post', `/orders/${x1.body.id}/assign-driver`, { driverId: std.DR1.id }],
      ['post', `/payments/${topup.body.id}/approve`, { bankReference: 'FT-ROLE-1', bankAmountPaisa: 500000, bankTime: new Date().toISOString() }],
      ['post', `/admin/distributors/${std.DA.id}/wallet/corrections`, { direction: 'ADD', amountPaisa: 10000, reasonCode: 'OTHER', note: 'Role test' }],
      ['get', '/settings'],
      ['patch', '/settings/orders.maxCylindersPerOrder', { value: 40, reason: 'Role refusal test' }],
      ['get', '/audit-logs'],
      ['get', '/users'],
      ['post', '/expenses', { expenseDate: '2026-10-22', amountPaisa: 10000, typeId: std.DA.id, note: 'Role test' }],
      ['get', '/reports/fuel-consumption'],
      ['get', '/stores'],
      ['post', '/custody/scan', { qrCode: 'AG-C0001', eventType: 'SCAN_OUT', tripId: x1.body.id }],
      ['get', '/trips/mine'],
      ['patch', `/drivers/${std.DR1.id}/location`, { lat: 31.5, lng: 74.3 }],
      ['get', '/distributors'],
      [
        'post',
        '/distributors',
        { phone: '0321 5550099', name: 'Role Test', businessName: 'Role Gas', code: 'RG', store: { name: 'Role Store', address: 'Road', lat: 31.52, lng: 74.22 } },
      ],
    ]);
    // Step 2.
    await expectDenied(driver, [
      ['post', '/orders', x2OrderBody(std)],
      ['post', '/orders/quote', x2OrderBody(std)],
      ['get', '/wallet'],
      ['post', '/clients', { name: 'Driver Customer', phone: '0333 4445557' }],
      ['get', '/clients'],
      ['post', '/payments/topup-requests', { amountPaisa: 100000, payerName: 'Driver', payerChannel: 'BANK_APP' }],
      ['get', `/zones/locate?lat=31.52&lng=74.22`],
      ['get', '/admin/wallets'],
      ['patch', '/settings/orders.maxCylindersPerOrder', { value: 40, reason: 'Role refusal test' }],
      ['get', '/audit-logs'],
      ['post', '/expenses', { expenseDate: '2026-10-22', amountPaisa: 10000, typeId: std.DA.id, note: 'Role test' }],
      ['get', '/reports/fuel-consumption'],
      ['get', '/distributors'],
    ]);
    // Nothing changed.
    expect((await db().payment.findUniqueOrThrow({ where: { id: topup.body.id } })).status).toBe('PENDING');
    expect((await db().distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).advanceBalancePaisa).toBe(452_000n);
    expect(await db().expense.count()).toBe(0);
    expect((await db().order.findUniqueOrThrow({ where: { id: x1.body.id } })).status).toBe('PENDING');
    const setting = await send(office, ['get', '/settings']).expect(200);
    expect((setting.body as Array<{ key: string; value: unknown }>).find((r) => r.key === 'orders.maxCylindersPerOrder')?.value).toBe(30);
  });

  /** DB is funded Rs 500 through an approved top-up and places BG-0001 (Rs 300); DA places X1. */
  async function twoShops(): Promise<{ x1: string; bg: string; bgTopup: string }> {
    const office = authHeader(std.SA1.actor);
    await app.get(SettingsService).set('topup.account', DUMMY_COMPANY_ACCOUNT, systemActor('cli:settings'), 'Ownership test account', {
      allowNotEditable: true,
    });
    const bilal = authHeader(std.DB.actor);
    const request = await send(bilal, ['post', '/payments/topup-requests', { amountPaisa: 50000, payerName: 'Bilal Gas', payerChannel: 'BANK_APP' }])
      .set('Idempotency-Key', KEY(21))
      .expect(201);
    await send(office, [
      'post',
      `/payments/${request.body.id}/approve`,
      { bankReference: 'FT-OWN-0001', bankAmountPaisa: 50000, bankTime: new Date(Date.now() - 60_000).toISOString() },
    ]).expect(200);
    const bg = await send(bilal, [
      'post',
      '/orders',
      {
        clientId: std.C3.id,
        addressId: std.C3.addressId,
        deliveryLabel: "Hina's house",
        lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 1 }],
      },
    ])
      .set('Idempotency-Key', KEY(22))
      .expect(201);
    const x1 = await send(authHeader(std.DA.actor), ['post', '/orders', x1OrderBody(std)]).set('Idempotency-Key', KEY(23)).expect(201);
    return { x1: x1.body.id, bg: bg.body.id, bgTopup: request.body.id };
  }

  it('SEC-013 DA can\'t see or cancel DB\'s orders (404)', async () => {
    const { bg } = await twoShops();
    const shop = authHeader(std.DA.actor);
    // Step 1.
    for (const url of [`/orders/${bg}`, `/orders/${bg}/tracking`]) {
      const res = await send(shop, ['get', url]).expect(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND', message: "We couldn't find this. It may have been removed." });
    }
    // Step 2.
    await send(shop, ['post', `/orders/${bg}/cancel`, { reasonCode: 'WRONG_ORDER' }]).set('Idempotency-Key', KEY(24)).expect(404);
    expect((await db().order.findUniqueOrThrow({ where: { id: bg } })).status).toBe('PENDING');
    expect(await db().ledgerEntry.count({ where: { entryType: 'CREDIT_ORDER_REVERSAL' } })).toBe(0);
    // Step 3.
    for (const url of ['/orders', '/orders?tab=active']) {
      const res = await send(shop, ['get', url]).expect(200);
      const rows = (Array.isArray(res.body) ? res.body : res.body.items) as Array<{ id: string; shortCode?: string }>;
      expect(rows.map((row) => row.id)).not.toContain(bg);
      for (const row of rows) if (row.shortCode) expect(row.shortCode).toMatch(/^AG-/);
    }
    // Step 4.
    const bilal = authHeader(std.DB.actor);
    expect((await send(bilal, ['get', `/orders/${bg}`]).expect(200)).body.id).toBe(bg);
    expect((await send(bilal, ['get', '/wallet']).expect(200)).body.balancePaisa).toBe('20000');
  });

  it('SEC-014 DA can\'t read DB\'s wallet, statement or top-ups', async () => {
    const { bgTopup } = await twoShops();
    const shop = authHeader(std.DA.actor);
    // Step 1: the distributorId parameter is ignored.
    expect((await send(shop, ['get', `/wallet?distributorId=${std.DB.id}`]).expect(200)).body.balancePaisa).toBe('452000');
    const statement = await send(shop, ['get', `/wallet/statement?distributorId=${std.DB.id}`]).expect(200);
    const daLedger = await db().ledgerEntry.findMany({ where: { distributorId: std.DA.id }, select: { id: true } });
    for (const item of statement.body.items as Array<{ id: string }>) expect(daLedger.map((row) => row.id)).toContain(item.id);
    expect((await send(shop, ['get', `/ledger/balance?distributorId=${std.DB.id}`]).expect(200)).body.balancePaisa).toBe('452000');
    const ledger = await send(shop, ['get', '/ledger/me']).expect(200);
    for (const row of ledger.body as Array<{ distributorId: string }>) expect(row.distributorId).toBe(std.DA.id);
    // Step 2.
    expect((await send(shop, ['get', `/payments/${bgTopup}`]).expect(404)).body.code).toBe('NOT_FOUND');
    const mine = await send(shop, ['get', '/payments/mine']).expect(200);
    for (const payment of mine.body as Array<{ distributorId?: string; shortCode?: string }>) {
      if (payment.shortCode) expect(payment.shortCode).toMatch(/^AG-T/);
      if (payment.distributorId) expect(payment.distributorId).toBe(std.DA.id);
    }
    // Step 3.
    expect((await send(shop, ['get', `/admin/distributors/${std.DB.id}/wallet`]).expect(403)).body.code).toBe('PERMISSION_DENIED');
  });
});
