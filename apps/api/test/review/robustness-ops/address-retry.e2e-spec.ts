/**
 * Review (robustness and operations), finding robustness-ops-13: the shop app's "Add address"
 * (NewAddressScreen, formerly PickAddressScreen) sends one Idempotency-Key per intent and retries with it after a timeout
 * (apps/mobile/src/screens/distributor/shared/api.ts addClientAddress). The API ignores the key on
 * POST /clients/:id/addresses, and addresses can't be edited or removed in the pilot, so a retried add
 * leaves a duplicate in the address picker.
 *
 * Verifier: REFUTED, documented contract. API_CONTRACT §1.2: the Idempotency-Key is used where §4.2 and
 * the routes that name it say, and "any other route ignores it"; §4.2 and G15-01 list the creates that
 * store the key (orders, payments, customers, refills, expenses, distributors), and §7.4
 * POST /clients/:id/addresses names none (addresses are add-only by design). No money or custody moves.
 * Making the add idempotent is a contract and data-model change (a client_addresses.client_request_id
 * column, §4.2 and §7.4), so this file pins today's documented answer: a retry is a second add.
 */
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { authHeader, createStandardData, describeDb, getTestPrisma, type StandardData } from '../../helpers';
import { http } from '../../helpers/http';

describeDb('review robustness: retrying "Add address" with the same Idempotency-Key', () => {
  let app: INestApplication;
  let std: StandardData;

  beforeAll(async () => {
    app = await createTestApp();
    std = await createStandardData();
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it('REFUTED robustness-ops-13 the address route ignores the Idempotency-Key, as documented: a retry is a second add (201, a new id)', async () => {
    const send = () =>
      http(app)
        .post(`/api/v1/clients/${std.C1.id}/addresses`)
        .set(authHeader(std.DA.actor))
        .set('Idempotency-Key', 'cdcdcdcd-cdcd-4dcd-8dcd-000000000001')
        .send({ label: 'Shop', lat: 31.531, lng: 74.231 });
    const first = await send();
    // The phone timed out before it saw the answer; the person taps "Save" again.
    const retry = await send();
    const rows = await getTestPrisma().clientAddress.count({ where: { clientId: std.C1.id, label: 'Shop' } });
    // eslint-disable-next-line no-console
    console.log(`[address retry] first ${first.status} ${first.body.id}; retry ${retry.status} ${retry.body.id}; "Shop" addresses: ${rows}`);
    expect({ first: first.status, retry: retry.status, replayHeader: retry.headers['idempotent-replay'] ?? null, sameId: retry.body.id === first.body.id, rows }).toEqual({
      first: 201,
      retry: 201,
      replayHeader: null,
      sameId: false,
      rows: 2,
    });
  });
});
