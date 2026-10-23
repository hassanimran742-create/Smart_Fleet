/**
 * REVIEW (contract-compat): captures real responses of the Inc 1 routes with the standard data, so their
 * shapes can be compared with API_CONTRACT §6-§7 and the shared-types DTOs. Writes one JSON file to the
 * review scratchpad (REVIEW_PROBE_OUT); asserts only that every probe answered.
 */
import type { INestApplication } from '@nestjs/common';
import * as fs from 'fs';
import { FilesService } from '../../../src/modules/files/files.service';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { createTestApp } from '../../helpers/app';
import { authHeader } from '../../helpers/auth';
import { getTestPrisma } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { createStandardData, x1OrderBody, type StandardData } from '../../helpers/standard-data';
import { setCompanyAccount } from '../../money/money-fixtures';

jest.setTimeout(120_000);
const API = '/api/v1';
const OUT =
  process.env.REVIEW_PROBE_OUT ??
  'C:/Users/Experts/AppData/Local/Temp/claude/d--smart-fleet/57654f05-d43e-46ff-b258-2d1d56cada85/scratchpad/review/contract-compat/probes.json';

describeDb('REVIEW contract-compat: response probes', () => {
  let app: INestApplication;
  let std: StandardData;
  const out: Record<string, unknown> = {};

  beforeAll(async () => {
    app = await createTestApp();
    app.get(SettingsService).invalidate();
    std = await createStandardData({ cylinders: true });
    await setCompanyAccount(app);
    const s3 = (app.get(FilesService) as unknown as { s3: { send: (command: unknown) => Promise<unknown> } }).s3;
    jest.spyOn(s3, 'send').mockImplementation(async () => ({}));
  });

  afterAll(async () => {
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
    await app?.close();
  });

  async function probe(name: string, req: PromiseLike<{ status: number; body: unknown; headers: Record<string, string> }>) {
    const res = await req;
    out[name] = { status: res.status, headers: pick(res.headers), body: res.body };
    return res;
  }
  function pick(h: Record<string, string>) {
    const keep: Record<string, string> = {};
    for (const k of ['x-already-applied', 'idempotent-replay', 'x-feature-disabled', 'retry-after', 'access-control-expose-headers']) if (h[k]) keep[k] = h[k];
    return keep;
  }

  it('probes', async () => {
    const DA = authHeader(std.DA.actor);
    const SA = authHeader(std.SA1.actor);
    const DR = authHeader(std.DR1.actor);
    await probe('app-config', http(app).get(`${API}/app/config`));
    await probe('distributor-home', http(app).get(`${API}/distributor/home`).set(DA));
    await probe('distributors-me', http(app).get(`${API}/distributors/me`).set(DA));
    await probe('distributors-list', http(app).get(`${API}/distributors`).set(SA));
    await probe('distributor-by-id', http(app).get(`${API}/distributors/${std.DA.id}`).set(SA));
    await probe('wallet', http(app).get(`${API}/wallet`).set(DA));
    await probe('topup-info', http(app).get(`${API}/payments/topup-info`).set(DA));
    await probe('pricing-quote-north', http(app).get(`${API}/pricing/quote?lat=31.53&lng=74.23`).set(DA));
    await probe('pricing-quote-east', http(app).get(`${API}/pricing/quote?lat=${std.zones.East.center.lat}&lng=${std.zones.East.center.lng}`).set(DA));
    await probe('pricing-quote-outside', http(app).get(`${API}/pricing/quote?lat=${std.outside.lat}&lng=${std.outside.lng}`).set(DA));
    await probe('pricing-quote-office-no-distributor', http(app).get(`${API}/pricing/quote?lat=31.53&lng=74.23`).set(SA));
    await probe('orders-quote', http(app).post(`${API}/orders/quote`).set(DA).send(x1OrderBody(std)));
    await probe('pricing-prices', http(app).get(`${API}/pricing/prices/${std.DA.id}`).set(SA));
    const placed = await probe('order-create', http(app).post(`${API}/orders`).set(DA).set('Idempotency-Key', '11111111-1111-4111-8111-111111111111').send(x1OrderBody(std)));
    await probe('order-create-replay', http(app).post(`${API}/orders`).set(DA).set('Idempotency-Key', '11111111-1111-4111-8111-111111111111').send(x1OrderBody(std)));
    const orderId = (placed.body as { id: string }).id;
    await probe('orders-tab-active', http(app).get(`${API}/orders?tab=active&limit=1`).set(DA));
    await probe('orders-tab-limit0', http(app).get(`${API}/orders?tab=active&limit=0`).set(DA));
    await probe('orders-tab-limit101', http(app).get(`${API}/orders?tab=active&limit=101`).set(DA));
    await probe('orders-tab-limitabc', http(app).get(`${API}/orders?tab=active&limit=abc`).set(DA));
    await probe('orders-tab-limit1.5', http(app).get(`${API}/orders?tab=active&limit=1.5`).set(DA));
    await probe('orders-board', http(app).get(`${API}/orders/board?tab=needs-driver`).set(SA));
    await probe('order-by-id-office', http(app).get(`${API}/orders/${orderId}`).set(SA));
    await probe('admin-summary', http(app).get(`${API}/admin/summary`).set(SA));
    await probe('admin-wallets', http(app).get(`${API}/admin/wallets`).set(SA));
    await probe('admin-wallet-detail', http(app).get(`${API}/admin/distributors/${std.DA.id}/wallet`).set(SA));
    await probe('admin-wallet-statement', http(app).get(`${API}/admin/distributors/${std.DA.id}/wallet/statement`).set(SA));
    await probe('wallet-statement', http(app).get(`${API}/wallet/statement`).set(DA));
    await probe('wallet-statement-badkind', http(app).get(`${API}/wallet/statement?kind=DELIVERY_COST,DELIVERY_COST`).set(DA));
    await probe('assign', http(app).post(`${API}/orders/${orderId}/assign-driver`).set(SA).send({ driverId: std.DR1.id }));
    await probe('assign-again', http(app).post(`${API}/orders/${orderId}/assign-driver`).set(SA).send({ driverId: std.DR1.id }));
    const order2 = await http(app).get(`${API}/orders/${orderId}`).set(DR);
    out['order-by-id-driver'] = { status: order2.status, body: order2.body };
    await probe('trip-office', http(app).get(`${API}/trips/${(order2.body as { trip: { id: string } }).trip.id}`).set(SA));
    await probe('trip-driver', http(app).get(`${API}/trips/${(order2.body as { trip: { id: string } }).trip.id}`).set(DR));
    await probe('cancel', http(app).post(`${API}/orders/${orderId}/cancel`).set(DA).send({ reasonCode: 'DUPLICATE' }));
    await probe('cancel-again', http(app).post(`${API}/orders/${orderId}/cancel`).set(DA).send({ reasonCode: 'DUPLICATE' }));
    await probe('settings', http(app).get(`${API}/settings`).set(SA));
    await probe('audit-logs', http(app).get(`${API}/audit-logs?limit=3`).set(SA));
    await probe('drivers-office', http(app).get(`${API}/drivers`).set(SA));
    await probe('driver-self', http(app).get(`${API}/drivers/${std.DR1.id}`).set(DR));
    await probe('expense-types', http(app).get(`${API}/expense-types`).set(SA));
    await probe('expenses', http(app).get(`${API}/expenses`).set(SA));
    await probe('expenses-summary', http(app).get(`${API}/expenses/summary`).set(SA));
    await probe('admin-topups', http(app).get(`${API}/admin/topups?tab=all`).set(SA));
    await probe('topup-request', http(app).post(`${API}/payments/topup-requests`).set(DA).send({ amountPaisa: '500000', payerName: 'Ahmed Raza', payerChannel: 'BANK_APP' }));
    await probe('payments-mine', http(app).get(`${API}/payments/mine`).set(DA));
    await probe('clients-office-no-distributor', http(app).get(`${API}/clients`).set(SA));
    await probe('clients-office-unknown', http(app).get(`${API}/clients?distributorId=00000000-0000-4000-8000-000000000000`).set(SA));
    await probe('clients-distributor', http(app).get(`${API}/clients`).set(DA));
    await probe('client-create', http(app).post(`${API}/clients`).set(DA).send({ name: 'Zara', phone: '0300 7654321', address: { label: 'Zara home', lat: 31.53, lng: 74.23 } }));
    await probe('client-address-add', http(app).post(`${API}/clients/${std.C1.id}/addresses`).set(DA).send({ label: 'Shop', lat: 31.531, lng: 74.231 }));
    await probe('not-found-envelope', http(app).get(`${API}/orders/00000000-0000-4000-8000-000000000000?x=1`).set(DA));
    await probe('unknown-route', http(app).get(`${API}/nope?x=1`).set(DA));
    await probe('refills-mine', http(app).get(`${API}/filling-orders/mine`).set(DA));
    await probe('users-me-distributor', http(app).get(`${API}/users/me`).set(DA));
    await probe('auth-me', http(app).get(`${API}/auth/me`).set(DA));
    await probe('stores', http(app).get(`${API}/stores`).set(SA));
    await probe('zones-city', http(app).get(`${API}/zones/city/${std.zones.North.cityId}`).set(DA));
    await probe('vehicles', http(app).get(`${API}/vehicles`).set(SA));
    await probe('cylinders', http(app).get(`${API}/cylinders`).set(SA));
    await probe('cylinder-by-qr', http(app).get(`${API}/cylinders/by-qr/AG-C0001-QR`).set(DA));
    await probe('health', http(app).get(`${API}/health`));
    await probe('health-live', http(app).get(`${API}/health/live`));
    await probe('admin-topups-cursor-from-orders', http(app).get(`${API}/admin/topups?tab=all&cursor=${Buffer.from(JSON.stringify(['2026-10-01T00:00:00.000Z', '00000000-0000-4000-8000-000000000000'])).toString('base64url')}`).set(SA));
    expect(Object.keys(out).length).toBeGreaterThan(50);
    void getTestPrisma;
  });
});
