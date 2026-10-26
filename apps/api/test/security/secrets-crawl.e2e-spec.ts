/**
 * No response carries a secret (API_CONTRACT §3.5, §8.6 "Access"): SEC-017. A crawler calls every GET
 * route in the Nest router as the office, both distributors and a driver, with ids filled from seeded
 * data, and refuses any body with a password hash, a CNIC or a token hash at any depth, or a value
 * that looks like a CNIC. The sign-in, refresh, profile and driver-create answers and the office's
 * socket snapshot are checked too.
 */
import type { INestApplication } from '@nestjs/common';
import { AlertSeverity, AlertType, CustodyType, PaymentProviderName } from '@prisma/client';
import { CnicVault } from '../../src/modules/users/cnic-vault.service';
import { createTestApp } from '../helpers/app';
import { authHeader, type TestActor } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http } from '../helpers/http';
import { createStandardData, STANDARD_PHONES, type StandardData } from '../helpers/standard-data';
import {
  APP_BOOT_TIMEOUT_MS,
  bearer,
  connectDrivers,
  listen,
  login,
  secretsIn,
  setPassword,
  useMemoryRateLimits,
  type SocketEvents, TEST_TIMEOUT_MS } from './security-helpers';

// Sign-ins hash with argon2 and the API boots once per suite: allow for a busy machine.
jest.setTimeout(TEST_TIMEOUT_MS);

/** The seeded CNICs, as typed with dashes; the 13 digits must never appear in a response either. */
const CNICS = {
  DA: '35202-1234567-1',
  DB: '35202-2345678-2',
  DR1: '35202-3456789-3',
  DR2: '35202-4567890-4',
} as const;
const CNIC_TEXTS = Object.values(CNICS).flatMap((cnic) => [cnic, cnic.replace(/-/g, '')]);

interface Seeded {
  x1: string;
  tripId: string;
  stopId: string;
  paymentId: string;
  cylinderId: string;
  cylinderQr: string;
  fileId: string;
  alertId: string;
  cityId: string;
}

describeDb('secrets: the response crawler', () => {
  let app: INestApplication;
  let baseUrl: string;
  let std: StandardData;
  let seeded: Seeded;
  const open: SocketEvents[] = [];
  const db = () => getTestPrisma();

  /** Problems in one response: secret keys, CNIC-like values and the seeded CNICs anywhere in the text. */
  function problemsOf(label: string, body: unknown, text: string): string[] {
    const found = secretsIn(body).map((problem) => `${label} ${problem}`);
    for (const cnic of CNIC_TEXTS) if (text.includes(cnic)) found.push(`${label} contains a seeded CNIC`);
    if (text.includes('$argon2')) found.push(`${label} contains a password hash`);
    return found;
  }

  async function seed(): Promise<Seeded> {
    const vault = app.get(CnicVault);
    for (const [key, cnic] of Object.entries(CNICS) as Array<[keyof typeof CNICS, string]>) {
      const userId = key.startsWith('DR') ? std[key as 'DR1' | 'DR2'].userId : std[key as 'DA' | 'DB'].userId;
      // Old rows also carry the plain legacy column; it must never leave the server either.
      await db().user.update({ where: { id: userId }, data: { ...vault.seal(cnic), cnic } });
      await setPassword(userId, 'Crawl#Pass2026');
    }
    await setPassword(std.SA1.id, 'Crawl#Pass2026');
    // X1, assigned to DR1 (written as the order service writes it: raw SQL for the geometry).
    const trip = await db().trip.create({
      data: { driverId: std.DR1.id, vehicleId: std.DR1.vehicleId as string, originStoreId: std.DA.homeStoreId },
    });
    const orders = await db().$queryRaw<Array<{ id: string }>>`
      INSERT INTO orders (id, distributor_id, client_id, delivery_address, delivery_address_label, dest_zone_id, origin_store_id,
                          order_no, status, payment_status, delivery_fee_paisa, fee_status, fee_strategy, fee_base_paisa,
                          trip_id, assigned_at, created_at, updated_at)
      VALUES (gen_random_uuid(), ${std.DA.id}::uuid, ${std.C1.id}::uuid, ST_SetSRID(ST_MakePoint(74.23, 31.53), 4326), 'Sana''s house',
              ${std.zones.North.id}::uuid, ${std.DA.homeStoreId}::uuid, 1, 'ASSIGNED', 'PAID_VIA_LEDGER', 25000, 'DEDUCTED',
              'DISTRIBUTOR_ZONE', 25000, ${trip.id}::uuid, now(), now(), now())
      RETURNING id`;
    const x1 = orders[0].id;
    await db().orderLine.createMany({
      data: [
        { orderId: x1, cylinderTypeId: std.sizes.kg11_8, fullCount: 2, expectedReturnCount: 2 },
        { orderId: x1, cylinderTypeId: std.sizes.kg45_4, fullCount: 1, expectedReturnCount: 1 },
      ],
    });
    const stops = await db().$queryRaw<Array<{ id: string }>>`
      INSERT INTO trip_stops (id, trip_id, order_id, store_id, seq, stop_type, status, location)
      VALUES (gen_random_uuid(), ${trip.id}::uuid, NULL, ${std.DA.homeStoreId}::uuid, 1, 'STORE_PICKUP', 'PENDING', ST_SetSRID(ST_MakePoint(74.22, 31.52), 4326)),
             (gen_random_uuid(), ${trip.id}::uuid, ${x1}::uuid, NULL, 2, 'DELIVERY', 'PENDING', ST_SetSRID(ST_MakePoint(74.23, 31.53), 4326))
      RETURNING id`;
    const payment = await db().payment.create({
      data: { distributorId: std.DA.id, requestNo: 1, amountPaisa: 500000n, provider: PaymentProviderName.BANK_MANUAL, payerName: 'Ahmed Gas' },
    });
    const cylinder = await db().cylinder.findFirstOrThrow({ where: { distributorId: std.DA.id } });
    const file = await db().storedFile.create({
      data: {
        storageKey: 'uploads/2026-10-22/crawl-test.jpg',
        purpose: 'TOPUP_PROOF',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        sha256: 'a'.repeat(64),
        uploadedByUserId: std.DA.userId,
        distributorId: std.DA.id,
      },
    });
    const alert = await db().alert.create({
      data: { alertType: AlertType.OTHER, severity: AlertSeverity.INFO, title: 'Crawl test', body: 'Crawl test alert', resourceType: 'Distributor', resourceId: std.DA.id },
    });
    await db().fuelRefill.create({ data: { vehicleId: std.DR1.vehicleId as string, driverId: std.DR1.id, litres: 12, costPaisa: 350000n, odometerKm: 900 } });
    await db().expoPushToken.create({ data: { userId: std.DR1.userId, token: 'ExponentPushToken[crawl]' } });
    await db().otpCode.create({ data: { phone: STANDARD_PHONES.DA, codeHash: '$argon2id$v=19$crawl', purpose: 'LOGIN', expiresAt: new Date(Date.now() + 60_000) } });
    await db().supportTicket.create({ data: { subjectType: 'GENERAL', reporterUserId: std.DA.userId, subject: 'Crawl', body: 'Crawl ticket' } });
    // A cylinder on DR1's van and DR2 online with a position: more shapes to crawl.
    await db().cylinder.update({ where: { id: cylinder.id }, data: { custodyType: CustodyType.VEHICLE, custodyId: std.DR1.vehicleId as string } });
    await db().$executeRaw`
      UPDATE drivers SET is_online = TRUE, current_location = ST_SetSRID(ST_MakePoint(74.21, 31.51), 4326), current_location_updated_at = now()
      WHERE id = ${std.DR2.id}::uuid`;
    await db().distributor.update({ where: { id: std.DA.id }, data: { nextOrderNo: 2, nextTopupNo: 2 } });
    return {
      x1,
      tripId: trip.id,
      stopId: stops[1].id,
      paymentId: payment.id,
      cylinderId: cylinder.id,
      cylinderQr: cylinder.qrCode,
      fileId: file.id,
      alertId: alert.id,
      cityId: std.zones.North.cityId,
    };
  }

  /** Every GET route the API registered, as Express paths ("/api/v1/drivers/:id"). */
  function getRoutes(): string[] {
    const express = app.getHttpAdapter().getInstance() as {
      _router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> };
    };
    const paths = express._router.stack.filter((layer) => layer.route?.methods.get).map((layer) => layer.route!.path);
    return [...new Set(paths)].sort();
  }

  /** Candidate ids for each `:param`, by its name or the path segment before it. */
  function candidatesFor(path: string, param: string): string[] {
    const ids: Record<string, string[]> = {
      users: [std.SA1.id, std.DA.userId, std.DR1.userId],
      drivers: [std.DR1.id, std.DR2.id],
      distributors: [std.DA.id, std.DB.id],
      vehicles: [std.DR1.vehicleId as string],
      stores: [std.DA.homeStoreId, std.DB.homeStoreId],
      zones: [std.zones.North.id],
      cities: [seeded.cityId],
      clients: [std.C1.id, std.C3.id],
      cylinders: [seeded.cylinderId],
      orders: [seeded.x1],
      trips: [seeded.tripId],
      stops: [seeded.stopId],
      payments: [seeded.paymentId],
      files: [seeded.fileId],
      alerts: [seeded.alertId],
    };
    const aliases: Record<string, string> = {
      user: 'users',
      driver: 'drivers',
      distributor: 'distributors',
      vehicle: 'vehicles',
      store: 'stores',
      zone: 'zones',
      city: 'cities',
      client: 'clients',
      cylinder: 'cylinders',
      order: 'orders',
      trip: 'trips',
      stop: 'stops',
      payment: 'payments',
      file: 'files',
      alert: 'alerts',
    };
    if (param === 'qr' || param === 'qrCode') return [seeded.cylinderQr];
    const byName = /^(\w+)Id$/.exec(param)?.[1];
    if (byName && (ids[byName] ?? ids[aliases[byName]])) return ids[byName] ?? ids[aliases[byName]];
    const segments = path.split('/').filter(Boolean);
    const at = segments.indexOf(`:${param}`);
    for (let i = at - 1; i >= 0; i--) {
      const segment = segments[i];
      if (segment.startsWith(':')) continue;
      const key = ids[segment] ? segment : aliases[segment];
      if (key) return ids[key];
      break;
    }
    return [...new Set(Object.values(ids).flat())];
  }

  /** The concrete URLs to call for one route path. */
  function urlsFor(path: string): string[] {
    const params = [...path.matchAll(/:(\w+)/g)].map((m) => m[1]);
    let urls = [path];
    for (const param of params) {
      urls = urls.flatMap((url) => candidatesFor(path, param).map((id) => url.replace(`:${param}`, encodeURIComponent(id))));
    }
    const extras: Record<string, string[]> = {
      '/api/v1/clients': [`?distributorId=${std.DA.id}`],
      '/api/v1/orders': ['?tab=active', '?tab=done'],
      '/api/v1/alerts': ['?status=OPEN'],
    };
    return [...urls, ...(extras[path] ?? []).map((query) => `${path}${query}`)];
  }

  beforeAll(async () => {
    app = await createTestApp();
    useMemoryRateLimits(app);
    baseUrl = await listen(app);
    await resetDb();
    std = await createStandardData({ cylinders: true });
    seeded = await seed();
  }, APP_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    for (const client of open.splice(0)) client.socket.disconnect();
    await app?.close();
  });

  it('SEC-017 no GET route anywhere returns a password hash, a CNIC or a token hash', async () => {
    const routes = getRoutes();
    expect(routes.length).toBeGreaterThan(80);
    const callers: Array<[string, TestActor]> = [
      ['SA1', std.SA1.actor],
      ['DA', std.DA.actor],
      ['DB', std.DB.actor],
      ['DR1', std.DR1.actor],
    ];
    const problems: string[] = [];
    let answered = 0;
    let ok = 0;
    for (const [who, actor] of callers) {
      for (const path of routes) {
        for (const url of urlsFor(path)) {
          const res = await http(app).get(url).set(authHeader(actor));
          answered += 1;
          if (res.status === 200) ok += 1;
          problems.push(...problemsOf(`${who} GET ${url} (${res.status})`, res.body, res.text ?? ''));
        }
      }
    }
    expect(problems).toEqual([]);
    // The crawl reached real data, not only refusals.
    expect(answered).toBeGreaterThan(300);
    expect(ok).toBeGreaterThan(100);
  }, 900_000);

  it('SEC-017 the sign-in, refresh, profile and driver answers and the office\'s socket snapshot carry no secret', async () => {
    const signedIn = await login(app, STANDARD_PHONES.DA, 'Crawl#Pass2026').expect(200);
    const refreshed = await http(app).post('/api/v1/auth/refresh').send({ refreshToken: signedIn.body.refreshToken }).expect(200);
    const profile = await http(app).patch('/api/v1/users/me').set(bearer(refreshed.body.accessToken)).send({ name: 'Ahmed Gas' }).expect(200);
    const driver = await http(app)
      .post('/api/v1/drivers')
      .set(authHeader(std.SA1.actor))
      .send({ name: 'Crawl Driver', phone: '0345 7778889', licenceNo: 'CRAWL-1', cnic: '35202-5678901-5' })
      .expect(201);
    expect(driver.body.cnicMasked).toBe('*****-****901-5');
    const office = connectDrivers(baseUrl, (await login(app, STANDARD_PHONES.SA1, 'Crawl#Pass2026').expect(200)).body.accessToken);
    open.push(office);
    const snapshot = await office.next('drivers:snapshot');
    const problems = [
      ...problemsOf('POST /auth/login', signedIn.body, signedIn.text),
      ...problemsOf('POST /auth/refresh', refreshed.body, refreshed.text),
      ...problemsOf('PATCH /users/me', profile.body, profile.text),
      ...problemsOf('POST /drivers', driver.body, driver.text.replace('*****-****901-5', '')),
      ...problemsOf('drivers:snapshot', snapshot, JSON.stringify(snapshot)),
    ];
    expect(JSON.stringify(driver.body)).not.toMatch(/3520256789015|35202-5678901-5/);
    expect(problems).toEqual([]);
  });

  it('SEC-017 the distributor create answer carries no secret, and an order\'s driver is exactly { id, name, phone }', async () => {
    const created = await http(app)
      .post('/api/v1/distributors')
      .set(authHeader(std.SA1.actor))
      .set('Idempotency-Key', '66666666-ffff-4fff-8fff-000000000001')
      .send({
        phone: '0321 5550077',
        name: 'Crawl Owner',
        businessName: 'Crawl Gas',
        code: 'CW',
        cnic: '35202-6789012-6',
        store: { name: 'Crawl Store', address: '1 Canal Road', lat: 31.52, lng: 74.21 },
      })
      .expect(201);
    expect(problemsOf('POST /distributors', created.body, created.text.replace(String(created.body.cnicMasked ?? ''), ''))).toEqual([]);
    expect(JSON.stringify(created.body)).not.toMatch(/3520267890126|35202-6789012-6/);
    // Step 3.
    const order = await http(app).get(`/api/v1/orders/${seeded.x1}`).set(authHeader(std.DA.actor)).expect(200);
    expect(order.body.trip.driver).toEqual({ id: std.DR1.id, name: 'Kashif', phone: STANDARD_PHONES.DR1 });
  });
});
