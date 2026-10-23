/**
 * REVIEW (contract-compat): replays the installed 0.1.0 shop and driver apps (git HEAD af889bf,
 * apps/mobile/src) against the new server. Every request is sent exactly as the old screens send it:
 * no X-App-Variant, no X-App-Version, no Idempotency-Key, the old bodies. Each step then checks the
 * fields the old screen reads (names and types), so a response that would break an old screen fails.
 */
import type { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import { CustodyType, CylinderState } from '@prisma/client';
import { FilesService } from '../../../src/modules/files/files.service';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { createTestApp } from '../../helpers/app';
import { authHeader } from '../../helpers/auth';
import { getTestPrisma, walletMismatches } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http } from '../../helpers/http';
import { createStandardData, STANDARD_PHONES, type StandardData } from '../../helpers/standard-data';
import { setCompanyAccount } from '../../money/money-fixtures';

jest.setTimeout(120_000);

const API = '/api/v1';
const PASSWORD = 'OldApp#2026';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]), Buffer.alloc(2048, 0x41)]);

describeDb('REVIEW contract-compat: the installed 0.1.0 apps replayed against the new server', () => {
  let app: INestApplication;
  let std: StandardData;
  const db = () => getTestPrisma();

  // The old axios client: Authorization (from SecureStore) and JSON, nothing else.
  const old = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

  /** This suite's sign-in rate-limit windows (5 per phone per 10 minutes) are cleared, so reruns start fresh. */
  async function clearRateLimitWindows(): Promise<void> {
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 1 });
    const prefix = process.env.BULLMQ_PREFIX || 'bull';
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:rl:*`, 'COUNT', 500);
      if (keys.length > 0) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
    await redis.quit();
  }

  beforeAll(async () => {
    await clearRateLimitWindows();
    app = await createTestApp();
    app.get(SettingsService).invalidate();
    std = await createStandardData({ cylinders: true });
    await setCompanyAccount(app);
    const s3 = (app.get(FilesService) as unknown as { s3: { send: (command: unknown) => Promise<unknown> } }).s3;
    jest.spyOn(s3, 'send').mockImplementation(async () => ({}));
    const hash = await argon2.hash(PASSWORD);
    await db().user.updateMany({ where: { id: { in: [std.DA.userId, std.DR1.userId] } }, data: { passwordHash: hash } });
  });

  afterAll(async () => {
    await app?.close();
  });

  async function oldLogin(phone: string): Promise<{ accessToken: string; refreshToken: string; role: string }> {
    // PhoneScreen.tsx:41 — the phone field starts with "+923".
    const res = await http(app).post(`${API}/auth/login`).set('Content-Type', 'application/json').send({ phone, password: PASSWORD });
    expect(res.status).toBeLessThan(300);
    expect(typeof res.body.accessToken).toBe('string');
    expect(typeof res.body.refreshToken).toBe('string');
    expect(typeof res.body.role).toBe('string');
    return res.body;
  }

  it('the shop app: home, add customer, place order, track, top-up with receipt, refill, profile', async () => {
    const { accessToken: token, role } = await oldLogin(STANDARD_PHONES.DA);
    expect(role).toBe('DISTRIBUTOR');
    const h = old(token);

    // HomeScreen.tsx:18 / SideMenu.tsx:151 — Number(balance.data.balancePaisa) / 100.
    const balance = await http(app).get(`${API}/ledger/balance`).set(h).expect(200);
    expect(Number.isFinite(Number(balance.body.balancePaisa))).toBe(true);
    expect(Number(balance.body.balancePaisa)).toBe(500_000);

    // HomeScreen.tsx:22 — a bare array of orders with `status`.
    const orders0 = await http(app).get(`${API}/orders`).set(h).expect(200);
    expect(Array.isArray(orders0.body)).toBe(true);

    // SideMenu.tsx:146 / ProfileScreen.tsx:12 — name, phone, distributorProfile.businessName and .id, role, status, createdAt.
    const me = await http(app).get(`${API}/users/me`).set(h).expect(200);
    expect(me.body).toMatchObject({ name: expect.any(String), phone: STANDARD_PHONES.DA, role: 'DISTRIBUTOR', status: 'ACTIVE' });
    expect(me.body.distributorProfile).toMatchObject({ id: std.DA.id, businessName: 'Ahmed Gas' });
    expect(typeof me.body.createdAt).toBe('string');
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|cnicEncrypted|cnicIndex|tokenHash/);

    // PlaceOrderScreen.tsx:66,71 — clients (id, name, phone, area, city) and sizes (id, code, name, weightKg).
    const clients = await http(app).get(`${API}/clients`).set(h).expect(200);
    expect(Array.isArray(clients.body)).toBe(true);
    for (const c of clients.body) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.name).toBe('string');
      expect(typeof c.phone).toBe('string');
    }
    const types = await http(app).get(`${API}/cylinder-types`).set(h).expect(200);
    expect(Array.isArray(types.body)).toBe(true);
    for (const t of types.body) {
      expect(typeof t.id).toBe('string');
      expect(typeof t.name).toBe('string');
      expect(Number.isFinite(Number(t.weightKg))).toBe(true);
    }

    // AddClientScreen.tsx:93 — the exact old body: address is the (always empty) free-text field.
    const created = await http(app)
      .post(`${API}/clients`)
      .set(h)
      .send({
        name: 'Rafiq',
        phone: '+923331234999',
        address: '',
        area: 'Model Town',
        city: 'Islamabad',
        creditLimitRs: 0,
        priority: 3,
        notes: '',
      });
    expect(created.status).toBe(201);
    // AddClientScreen.tsx:104,114 — created.data.id and client.name.
    expect(typeof created.body.id).toBe('string');
    expect(created.body.name).toBe('Rafiq');
    const clientId: string = created.body.id;
    const addr = await http(app)
      .post(`${API}/clients/${clientId}/addresses`)
      .set(h)
      .send({ label: 'House 14, Street 5', lat: 31.531, lng: 74.231 });
    expect(addr.status).toBe(201);

    // PlaceOrderScreen.tsx:76,118,440 — saved addresses: id, label, lat and lng as numbers (pin.lat.toFixed(5)).
    const saved = await http(app).get(`${API}/clients/${clientId}/addresses`).set(h).expect(200);
    expect(saved.body).toHaveLength(1);
    expect(typeof saved.body[0].lat).toBe('number');
    expect(typeof saved.body[0].lng).toBe('number');
    expect(saved.body[0].label).toBe('House 14, Street 5');

    // PlaceOrderScreen.tsx:131 — the exact old order body (deliveryLocation, never addressId).
    const pin = { lat: saved.body[0].lat, lng: saved.body[0].lng };
    const placed = await http(app)
      .post(`${API}/orders`)
      .set(h)
      .send({
        clientId,
        deliveryLabel: 'House 14, Street 5 · Model Town',
        deliveryLocation: pin,
        lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 3, expectedReturnCount: 3 }],
      });
    expect(placed.status).toBe(201);
    const orderId: string = placed.body.id;

    // OrderHistoryScreen.tsx:54-84 / NotificationsScreen.tsx:43-46 — the bare array row the old list reads.
    const orders1 = await http(app).get(`${API}/orders`).set(h).expect(200);
    const row = orders1.body.find((o: { id: string }) => o.id === orderId);
    expect(row).toBeDefined();
    expect(row.client.name).toBe('Rafiq');
    expect(row.deliveryAddressLabel).toBe('House 14, Street 5 · Model Town');
    expect(row.lines[0]).toMatchObject({ fullCount: 3, expectedReturnCount: 3 });
    expect(Number.isNaN(new Date(row.createdAt).getTime())).toBe(false);
    expect(typeof row.status).toBe('string');
    expect(typeof row.paymentStatus).toBe('string');
    expect(Number.isFinite(Number(row.deliveryFeePaisa))).toBe(true);

    // TrackOrderScreen.tsx:18,153-164 — t.orderId.slice(0, 8), status, paymentStatus, deliveryFeePaisa, destination.
    const track = await http(app).get(`${API}/orders/${orderId}/tracking`).set(h).expect(200);
    expect(typeof track.body.orderId).toBe('string');
    expect(track.body.destination).toEqual({ lat: expect.any(Number), lng: expect.any(Number) });
    expect(track.body.driver).toBeNull();

    // TopupScreen.tsx:40 — Rs 5,000, provider BANK_MANUAL; reads paymentId and formFields.instructions.
    const topup = await http(app).post(`${API}/payments/topup`).set(h).send({ amountPaisa: 500000, provider: 'BANK_MANUAL' });
    expect(topup.status).toBeLessThan(300);
    expect(typeof topup.body.paymentId).toBe('string');
    expect(typeof topup.body.formFields.instructions).toBe('string');

    // upload.ts:39-56 — fetch multipart with only `file` (no purpose); reads data.url.
    const up = await http(app).post(`${API}/files/upload`).set('Authorization', `Bearer ${token}`).attach('file', JPEG, { filename: 'slip.jpg', contentType: 'image/jpeg' });
    expect(up.status).toBe(201);
    expect(typeof up.body.url).toBe('string');

    // TopupScreen.tsx:60 — bank-proof with that (signed) URL.
    const proof = await http(app).post(`${API}/payments/${topup.body.paymentId}/bank-proof`).set(h).send({ proofUrl: up.body.url });
    expect(proof.status).toBeLessThan(300);

    // TopupScreen.tsx:31,118-141 — id, amountPaisa, status, proofUrl, createdAt.
    const mine = await http(app).get(`${API}/payments/mine`).set(h).expect(200);
    expect(Array.isArray(mine.body)).toBe(true);
    const p = mine.body.find((x: { id: string }) => x.id === topup.body.paymentId);
    expect(p).toMatchObject({ status: 'PENDING', proofUrl: expect.any(String) });
    expect(Number(p.amountPaisa)).toBe(500000);

    // RequestFillingScreen.tsx:34,63,174 — stations with price_per_cylinder_paisa (Number(...) / 100).
    await db().$executeRaw`
      INSERT INTO filling_stations (id, name, address, location, price_per_cylinder_paisa, is_active, created_at, updated_at)
      VALUES (gen_random_uuid(), 'Lahore Fill', 'Ring Road', ST_SetSRID(ST_MakePoint(74.24, 31.52), 4326), 25000, TRUE, now(), now())`;
    const stations = await http(app).get(`${API}/filling-stations`).set(h).expect(200);
    expect(stations.body.length).toBeGreaterThan(0);
    for (const s of stations.body) expect(Number.isFinite(Number(s.price_per_cylinder_paisa))).toBe(true);

    // RequestFillingScreen.tsx:75 — OUR_SERVICE, one request per cart line.
    const refill = await http(app)
      .post(`${API}/filling-orders`)
      .set(h)
      .send({ fillingStationId: stations.body[0].id, cylinderTypeId: std.sizes.kg11_8, requestedCount: 2, serviceType: 'OUR_SERVICE' });
    expect(refill.status).toBe(201);
    // RequestFillingScreen.tsx:244-250 — requestedCount, cylinderType.code, fillingStation.name, totalCostPaisa, createdAt, status.
    const refills = await http(app).get(`${API}/filling-orders/mine`).set(h).expect(200);
    expect(refills.body[0]).toMatchObject({ requestedCount: 2, status: 'PENDING', cylinderType: { code: 'STD_11_8KG' }, fillingStation: { name: 'Lahore Fill' } });
    expect(Number(refills.body[0].totalCostPaisa)).toBe(0);

    // ProfileScreen.tsx:36 — the old Save always sends phone, cnic and businessName.
    const save = await http(app)
      .patch(`${API}/users/me`)
      .set(h)
      .send({ name: 'Ahmed', email: '', phone: STANDARD_PHONES.DA, cnic: '', businessName: 'Ahmed Gas' });
    expect(save.status).toBe(403);
    expect(save.body.code).toBe('USER_FIELD_OFFICE_ONLY');
    expect(typeof save.body.message).toBe('string');
  });

  it('the old sign-in screen: refusals never mention a code, and the ledger and inventory reads keep their shapes', async () => {
    // PhoneScreen.tsx:51-65 — the old screen jumps to the OTP flow when the message mentions "otp" or "one-time code".
    const wrong = await http(app).post(`${API}/auth/login`).send({ phone: STANDARD_PHONES.DA, password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).not.toMatch(/otp|one-time code/i);
    const admin = await db().user.create({ data: { phone: '+923339990001', name: 'Legacy admin', role: 'ADMIN', status: 'ACTIVE', passwordHash: await argon2.hash(PASSWORD) } });
    const locked = await http(app).post(`${API}/auth/login`).send({ phone: admin.phone, password: PASSWORD });
    expect(locked.status).toBe(403);
    expect(locked.body.code).toBe('AUTH_ROLE_LOCKED');
    expect(locked.body.message).not.toMatch(/otp|one-time code/i);
    const otp = await http(app).post(`${API}/auth/otp/send`).send({ phone: STANDARD_PHONES.DA });
    expect(otp.status).toBe(403);
    expect(otp.body.code).toBe('AUTH_OTP_DISABLED');

    const { accessToken } = await oldLogin(STANDARD_PHONES.DA);
    // LedgerScreen.tsx:8-20 — entryType, Number(amountPaisa), Number(balanceAfterPaisa), createdAt.
    const ledger = await http(app).get(`${API}/ledger/me`).set(old(accessToken)).expect(200);
    expect(Array.isArray(ledger.body)).toBe(true);
    for (const row of ledger.body) {
      expect(typeof row.entryType).toBe('string');
      expect(Number.isFinite(Number(row.amountPaisa))).toBe(true);
      expect(Number.isFinite(Number(row.balanceAfterPaisa))).toBe(true);
      expect(Number.isNaN(new Date(row.createdAt).getTime())).toBe(false);
      expect(row).not.toHaveProperty('note');
    }
    // AnalyticsScreen.tsx:16 / InventoryScreen.tsx:17 — an array of { holderType, state, count }.
    const inventory = await http(app).get(`${API}/inventory/me`).set(old(accessToken)).expect(200);
    expect(Array.isArray(inventory.body)).toBe(true);
  });

  it('the driver app: home, trip, start, load scans, done loading, arrive, deliver scans, delivered, empties, done, finish', async () => {
    // A fresh order for DA, assigned by the office (the new website).
    const placed = await http(app)
      .post(`${API}/orders`)
      .set(authHeader(std.DA.actor))
      .send({
        clientId: std.C1.id,
        addressId: std.C1.addressId,
        deliveryLabel: "Sana's house",
        lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 2, expectedReturnCount: 1 }],
      })
      .expect(201);
    const orderId: string = placed.body.id;
    const assigned = await http(app)
      .post(`${API}/orders/${orderId}/assign-driver`)
      .set(authHeader(std.SA1.actor))
      .send({ driverId: std.DR1.id })
      .expect(200);
    const tripId: string = assigned.body.tripId;
    // An empty the customer already has (for the old "Scan empty" step).
    const empty = await db().cylinder.create({
      data: {
        serial: 'AG-C0900',
        qrCode: 'AG-C0900-QR',
        distributorId: std.DA.id,
        cylinderTypeId: std.sizes.kg11_8,
        state: CylinderState.FULL,
        custodyType: CustodyType.CLIENT,
        custodyId: std.C1.id,
      },
    });

    const { accessToken: token, role } = await oldLogin(STANDARD_PHONES.DR1);
    expect(role).toBe('DRIVER');
    const h = old(token);

    // HomeScreen.tsx:21,40-41,96,180-206 — a bare array; status, id, stops.length, orders[].lines[].fullCount, client.name.
    const trips = await http(app).get(`${API}/trips/mine`).set(h).expect(200);
    expect(Array.isArray(trips.body)).toBe(true);
    const active = trips.body.find((t: { status: string }) => t.status === 'PLANNED' || t.status === 'IN_PROGRESS');
    expect(active.id).toBe(tripId);
    expect(active.stops).toHaveLength(2);
    expect(active.orders[0].client.name).toBe('Sana');
    expect(active.orders[0].lines[0].fullCount).toBe(2);
    // NotificationsScreen.tsx:59-62.
    expect(typeof active.id.slice(0, 8)).toBe('string');

    // HomeScreen.tsx:26,132 — s.distanceKm.toFixed(1) on every suggestion.
    await db().$executeRaw`UPDATE drivers SET current_location = ST_SetSRID(ST_MakePoint(74.221, 31.521), 4326) WHERE id = ${std.DR1.id}::uuid`;
    const suggestions = await http(app).get(`${API}/trips/next-suggestions`).set(h).expect(200);
    expect(Array.isArray(suggestions.body)).toBe(true);
    for (const s of suggestions.body) expect(typeof s.distanceKm).toBe('number');

    // HomeScreen.tsx:36 — transfers are switched off: [] (no crash on `.length`).
    const transfers = await http(app).get(`${API}/transfers/mine`).set(h).expect(200);
    expect(transfers.body).toEqual([]);
    expect(transfers.headers['x-feature-disabled']).toBe('transfers');

    // VehicleLoad.tsx:34-187.
    const load = await http(app).get(`${API}/inventory/my-vehicle`).set(h).expect(200);
    expect(load.body).toMatchObject({ vehicleId: std.DR1.vehicleId, totalFull: expect.any(Number), totalEmpty: expect.any(Number), byType: expect.any(Array) });

    // ActiveTripScreen.tsx / DeliveryStepsScreen.tsx — the trip with stops, orders and originStore.
    const trip = await http(app).get(`${API}/trips/${tripId}`).set(h).expect(200);
    const storeStop = trip.body.stops.find((s: { stopType: string }) => s.stopType === 'STORE_PICKUP');
    const deliveryStop = trip.body.stops.find((s: { stopType: string }) => s.stopType === 'DELIVERY');
    expect(storeStop.location).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number) });
    expect(deliveryStop.location).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number) });
    expect(deliveryStop.orderId).toBe(orderId);
    expect(trip.body.orders[0]).toMatchObject({ id: orderId, status: 'ASSIGNED', deliveryAddressLabel: "Sana's house", client: { name: 'Sana' } });
    expect(trip.body.originStore.name).toBe('Ahmed Gas Store');

    // ActiveTripScreen.tsx:22 — "Start trip".
    await http(app).patch(`${API}/trips/${tripId}/status`).set(h).send({ status: 'IN_PROGRESS' }).expect(200);

    // DeliverySteps LOAD → ScanScreen.tsx:58 with orderId = stop.orderId (null on the store stop).
    for (const qr of ['AG-C0001-QR', 'AG-C0002-QR']) {
      const scan = await http(app).post(`${API}/custody/scan`).set(h).send({ qrCode: qr, eventType: 'SCAN_OUT', tripId, orderId: storeStop.orderId ?? null });
      expect(scan.status).toBe(201);
      // ScanScreen.tsx:67 — result.newState and result.toType.
      expect(scan.body).toMatchObject({ newState: 'FULL', toType: 'VEHICLE' });
    }
    // "✓ Done loading" — depart the store stop (no body).
    await http(app).patch(`${API}/trips/stops/${storeStop.id}/depart`).set(h).expect(200);
    // "📍 I arrived".
    await http(app).patch(`${API}/trips/stops/${deliveryStop.id}/arrive`).set(h).expect(200);
    // "📷 Scan delivered" ×2.
    for (const qr of ['AG-C0001-QR', 'AG-C0002-QR']) {
      const scan = await http(app).post(`${API}/custody/scan`).set(h).send({ qrCode: qr, eventType: 'DELIVERED', tripId, orderId });
      expect(scan.status).toBe(201);
      expect(scan.body).toMatchObject({ toType: 'CLIENT' });
    }
    // "✓ All delivered" — DeliveryStepsScreen.tsx:66.
    await http(app).patch(`${API}/orders/${orderId}/status`).set(h).send({ status: 'DELIVERED' }).expect(200);
    // EMPTIES phase — "📷 Scan empty".
    const back = await http(app).post(`${API}/custody/scan`).set(h).send({ qrCode: empty.qrCode, eventType: 'PICKED_UP_EMPTY', tripId, orderId });
    expect(back.status).toBe(201);
    expect(back.body).toMatchObject({ newState: 'EMPTY', toType: 'VEHICLE' });
    // "✓ Done".
    await http(app).patch(`${API}/trips/stops/${deliveryStop.id}/depart`).set(h).expect(200);
    // The old screen's phase logic after these steps.
    const after = await http(app).get(`${API}/trips/${tripId}`).set(h).expect(200);
    expect(after.body.orders[0].status).toBe('DELIVERED');
    expect(after.body.stops.every((s: { departedAt: string | null }) => !!s.departedAt)).toBe(true);
    // From Inc 2 a run finishes with an empty van (Appendix A, API_CONTRACT §9.3): the shop's new app scans
    // the taken-back empty into its store (POST /store/scans), as the store does at the end of every run.
    const received = await http(app)
      .post(`${API}/store/scans`)
      .set(authHeader(std.DA.actor))
      .send({ scanId: 'eeeeeeee-eeee-4eee-8eee-000000000901', code: empty.qrCode, entryMethod: 'QR' })
      .expect(201);
    expect(received.body).toMatchObject({ result: 'RECORDED', cylinder: { holder: { type: 'STORE' } }, fromVan: { plateNo: 'LEA-101' } });
    // "✓ Finish".
    await http(app).patch(`${API}/trips/${tripId}/status`).set(h).send({ status: 'COMPLETED' }).expect(200);

    // FuelRefillScreen.tsx:26-31 — data.currentVehicle.{id, plateNo, currentOdometerKm}.
    const self = await http(app).get(`${API}/drivers/${std.DR1.id}`).set(h).expect(200);
    expect(self.body.currentVehicle).toMatchObject({ id: std.DR1.vehicleId, plateNo: 'LEA-101' });
    // FuelRefillScreen.tsx:39 — fuel logs are switched off: [].
    const fuel = await http(app).get(`${API}/fuel-refills/mine`).set(h).expect(200);
    expect(fuel.body).toEqual([]);

    // VehicleInfoScreen.tsx / driver ProfileScreen.tsx — driverProfile.currentVehicle.
    const me = await http(app).get(`${API}/users/me`).set(h).expect(200);
    expect(me.body.driverProfile).toMatchObject({ licenceNo: expect.any(String), currentVehicle: { plateNo: 'LEA-101', capacityUnits: expect.any(Number) } });

    // The money: one debit at placement, nothing at the door.
    expect(await db().ledgerEntry.count({ where: { orderId } })).toBe(1);
    expect(await walletMismatches()).toEqual([]);
  });
});
