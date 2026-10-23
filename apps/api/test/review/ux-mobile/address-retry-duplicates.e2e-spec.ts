/**
 * REVIEW (ux-mobile): the shop app's "Change address → Add a new address → Save address" retry.
 *
 * apps/mobile/src/screens/distributor/PickAddressScreen.tsx keeps one Idempotency-Key per intent
 * (`useIdempotencyKey([clientId, label, pin])`) and sends it with `POST /clients/:id/addresses`
 * (shared/api.ts `addClientAddress`), exactly like the customer, order and top-up creates. UX_MOBILE
 * §3.1 says every create sends the key "and retries reuse it", so the phone treats "Save address"
 * tapped again after "This is taking too long" as safe.
 *
 * This replays what the phone sends when the first save reached the server but its reply was lost
 * (a weak signal), then the person taps "Save address" again: same key, same body. A replay of the
 * first address is expected (as `POST /clients` does); the server instead inserts a second one, and
 * addresses are add-only in the pilot (API_CONTRACT §7.4: no edit or delete route), so the duplicate
 * stays in the customer's "Saved addresses" for good.
 *
 * Finding mobile-ux-01. Verifier: REFUTED, documented contract. API_CONTRACT §1.2 says the key is used
 * where §4.2 or the route names it and "any other route ignores it"; §4.2 lists keyed creates only for
 * orders, payments, clients, (Inc 3) refills, expenses and distributors; §7.4 gives
 * POST /clients/:id/addresses no key; UX_MOBILE §6 promises no doubles only for orders and top-ups. No
 * money moves; the worst case is a duplicate row in the address picker. Making the route idempotent is a
 * contract and data-model change (a nullable client_addresses.client_request_id), so the second case
 * pins today's documented answer. The control (POST /clients replays) is unchanged.
 */
import type { INestApplication } from '@nestjs/common';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { createTestApp } from '../../helpers/app';
import { authHeader } from '../../helpers/auth';
import { getTestPrisma } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { createStandardData, type StandardData } from '../../helpers/standard-data';

jest.setTimeout(60_000);

const API = '/api/v1';
/** What the shop app sends on every request (api/client.ts appHeaders). */
const SHOP_APP = { 'X-App-Variant': 'distributor', 'X-App-Version': '0.1.0', 'Content-Type': 'application/json' };

describeDb('REVIEW ux-mobile: a retried "Save address" is not idempotent', () => {
  let app: INestApplication;
  let std: StandardData;
  const db = () => getTestPrisma();

  beforeAll(async () => {
    app = await createTestApp();
    app.get(SettingsService).invalidate();
    std = await createStandardData();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('control: POST /clients with the same Idempotency-Key replays the first customer (no duplicate)', async () => {
    const key = '0b6c7a3e-5d1f-4c8e-9a2b-3f4d5e6a7b81';
    const body = { name: 'Retry Customer', phone: '03124445556', address: { label: 'House 1', lat: 31.53, lng: 74.27 } };
    const h = { ...SHOP_APP, ...authHeader(std.DA.actor), 'Idempotency-Key': key };
    const first = await http(app).post(`${API}/clients`).set(h).send(body);
    expect(first.status).toBe(201);
    const again = await http(app).post(`${API}/clients`).set(h).send(body);
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(await db().client.count({ where: { distributorId: std.DA.id, name: 'Retry Customer' } })).toBe(1);
  });

  it('REFUTED mobile-ux-01 POST /clients/:id/addresses sent twice with one Idempotency-Key (lost reply, then "Save address" again) adds it twice, as documented', async () => {
    const key = '4f1d2c3b-6a5e-4b7c-8d9e-0a1b2c3d4e5f';
    const body = { label: 'Shop, Main Market', lat: 31.531, lng: 74.271 }; // inside South, priced for Ahmed Gas
    const h = { ...SHOP_APP, ...authHeader(std.DA.actor), 'Idempotency-Key': key };
    const before = await db().clientAddress.count({ where: { clientId: std.C2.id } });

    // 1st tap: the server saves it, but the phone's request times out (the reply never arrives).
    const first = await http(app).post(`${API}/clients/${std.C2.id}/addresses`).set(h).send(body);
    expect(first.status).toBe(201);

    // 2nd tap on "Save address": the same intent, so the same key and the same body.
    const again = await http(app).post(`${API}/clients/${std.C2.id}/addresses`).set(h).send(body);

    const after = await db().clientAddress.count({ where: { clientId: std.C2.id } });
    const list = await http(app).get(`${API}/clients/${std.C2.id}/addresses`).set({ ...SHOP_APP, ...authHeader(std.DA.actor) });
    const sameLabel = (list.body as Array<{ id: string; label: string }>).filter((a) => a.label === body.label);

    // The documented contract (§1.2, §4.2, §7.4): the key is ignored here, so the retry is a second add.
    expect({ status: again.status, replayHeader: again.headers['idempotent-replay'] ?? null, sameId: again.body.id === first.body.id, added: after - before, listed: sameLabel.length }).toEqual({
      status: 201,
      replayHeader: null,
      sameId: false,
      added: 2,
      listed: 2,
    });
  });
});
