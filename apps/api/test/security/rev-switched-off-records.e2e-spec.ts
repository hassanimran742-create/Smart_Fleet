/**
 * Regression test for review finding contract-compat-01 (API_CONTRACT §3.4): while a module is switched
 * off, a GET of one record (a route with an `:id`) answers 403 FEATURE_DISABLED with
 * `X-Feature-Disabled`, never `[]`, because its callers expect an object: the installed driver app's
 * TransferDetailScreen reads `t.lines.length` from `GET /transfers/:id` and crashed on `[]`. GET lists
 * keep answering `[]` with the header, so the installed apps that poll them keep working.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http, type TestResponse } from '../helpers/http';
import { createStandardData, type StandardData } from '../helpers/standard-data';
import { APP_BOOT_TIMEOUT_MS, TEST_TIMEOUT_MS } from './security-helpers';

jest.setTimeout(TEST_TIMEOUT_MS);

describeDb('switched-off modules: one record versus a list', () => {
  let app: INestApplication;
  let std: StandardData;
  const db = () => getTestPrisma();

  const answer = (res: TestResponse) => ({
    status: res.status,
    body: Array.isArray(res.body) ? res.body : res.body.code,
    header: res.headers['x-feature-disabled'],
  });

  beforeAll(async () => {
    app = await createTestApp();
    await resetDb();
    std = await createStandardData({ cylinders: true });
  }, APP_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
  });

  it('REV contract-compat-01 a single-record GET on a switched-off module is 403 FEATURE_DISABLED with the header; lists keep []', async () => {
    // A transfer left open from before the switch-over, assigned to DR1.
    const transfer = await db().transfer.create({
      data: {
        fromStoreId: std.DA.homeStoreId,
        toStoreId: std.DB.homeStoreId,
        driverId: std.DR1.id,
        vehicleId: std.DR1.vehicleId,
        status: 'REQUESTED',
        requestedBy: std.SA1.id,
      },
    });
    const driver = authHeader(std.DR1.actor);
    const office = authHeader(std.SA1.actor);
    const off = (name: string) => ({ status: 403, body: 'FEATURE_DISABLED', header: name });
    const empty = (name: string) => ({ status: 200, body: [], header: name });

    expect({
      transfer: answer(await http(app).get(`/api/v1/transfers/${transfer.id}`).set(driver)),
      progress: answer(await http(app).get(`/api/v1/transfers/${transfer.id}/progress`).set(driver)),
      accessory: answer(await http(app).get(`/api/v1/accessories/${transfer.id}`).set(office)),
      clientOrder: answer(await http(app).get(`/api/v1/client-portal/orders/${transfer.id}`).set(office)),
    }).toEqual({
      transfer: off('transfers'),
      progress: off('transfers'),
      accessory: off('accessories'),
      clientOrder: off('clientApp'),
    });
    // Lists, also those keyed by another path parameter, keep the empty answer.
    expect({
      mine: answer(await http(app).get('/api/v1/transfers/mine').set(driver)),
      transfers: answer(await http(app).get('/api/v1/transfers').set(office)),
      accessories: answer(await http(app).get('/api/v1/accessories').set(office)),
      accessoryStock: answer(await http(app).get(`/api/v1/accessories/stock/store/${std.DA.homeStoreId}`).set(office)),
      clientOrders: answer(await http(app).get('/api/v1/client-portal/orders').set(office)),
    }).toEqual({
      mine: empty('transfers'),
      transfers: empty('transfers'),
      accessories: empty('accessories'),
      accessoryStock: empty('accessories'),
      clientOrders: empty('clientApp'),
    });
    // The role check still comes first: a role the route never allows gets 403 PERMISSION_DENIED.
    const shop = await http(app).get(`/api/v1/transfers/${transfer.id}`).set(authHeader(std.DA.actor));
    expect({ status: shop.status, code: shop.body.code }).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
  });
});
