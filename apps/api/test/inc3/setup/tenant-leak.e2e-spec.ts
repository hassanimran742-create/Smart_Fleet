/**
 * SET-012: the two-shop leak test on the setup data (API_CONTRACT §10.4: "The two-distributor leak test,
 * built with the setup script, passes before distributor #2 joins"; §3.2 ownership policies).
 *
 * The standard data is loaded by the setup CLI with --test; Ahmed Gas then has Sana (C1), order X1 on
 * Kashif's run with AG-C0001 loaded on his van, top-up AG-T001, refill AG-R001 and a 2026-10-21 day-end.
 * Bilal Gas, balance Rs 0, must see none of it: every read of an Ahmed Gas row answers exactly as for an
 * unknown id, every list holds only Bilal Gas rows, and every write is refused without a trace.
 */
import { randomUUID } from 'crypto';
import * as path from 'path';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, forgetSettings } from '../../helpers/app';
import { authHeader, type TestActor } from '../../helpers/auth';
import { createDayClose, createStoredFile } from '../../helpers/day-end';
import { getTestPrisma, resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { http, type TestResponse } from '../../helpers/http';
import { createRefill } from '../../helpers/refills';
import { scanCalls } from '../../helpers/scan-calls';
import { useMemoryRateLimits } from '../../security/security-helpers';
import { POINTS, SAMPLE_FILE, removeScratchDir, runSetup, scratchDir, setupPeople, x1Body, type SetupPeople } from './support';

jest.setTimeout(240_000);

const API = '/api/v1';

/** The parts of an error body that must not differ between someone else's row and an unknown id. */
function refusal(res: TestResponse): { status: number; code: unknown; message: unknown; details: unknown; error: unknown } {
  return { status: res.status, code: res.body?.code, message: res.body?.message, details: res.body?.details, error: res.body?.error };
}

describeDb('two-shop leak test on the setup data (SET-012)', () => {
  let app: INestApplication;
  const db = () => getTestPrisma();
  const api = () => http(app);
  const dir = scratchDir('tenant-leak');

  interface AhmedGasRows {
    people: SetupPeople;
    x1: string;
    topupId: string;
    refillId: string;
    c1: string;
    cylinder: { id: string; qrCode: string };
    /** Every Ahmed Gas id and word a Bilal Gas answer must never hold. */
    marks: string[];
  }
  let rows: AhmedGasRows;

  beforeAll(async () => {
    app = await createTestApp();
    useMemoryRateLimits(app);
    await resetDb();
    const setup = await runSetup(['--file', SAMPLE_FILE, '--test', '--labels', path.join(dir, 'labels.csv')]);
    expect(setup.code).toBe(0);
    forgetSettings(app);
    const people = await setupPeople();

    const x1 = await api().post(`${API}/orders`).set(authHeader(people.DA)).set('Idempotency-Key', randomUUID()).send(x1Body(people)).expect(201);
    const topup = await api()
      .post(`${API}/payments/topup-requests`)
      .set(authHeader(people.DA))
      .set('Idempotency-Key', randomUUID())
      .send({ amountPaisa: 100000, payerName: 'Ahmed Gas', payerChannel: 'BANK_APP', transactionId: 'TX-2001' })
      .expect(201);
    expect((await db().payment.findUniqueOrThrow({ where: { id: topup.body.id }, select: { requestNo: true } })).requestNo).toBe(1); // AG-T001
    const station = await db().fillingStation.findFirstOrThrow({ where: { name: 'Lahore Filling Station' }, select: { id: true } });
    const refill = await createRefill({
      distributor: { id: people.DA.distributorId, code: 'AG', homeStoreId: people.DA.homeStoreId },
      cylinderTypeId: people.sizes.kg15,
      requestedCount: 2,
      station,
    });
    expect(refill.shortCode).toBe('AG-R001');
    const sheet = await createStoredFile({ purpose: 'DAY_END_SHEET', uploadedBy: { userId: people.DA.userId }, distributorId: people.DA.distributorId });
    await createDayClose({ distributor: { id: people.DA.distributorId }, businessDate: '2026-10-21', sheetFileId: sheet.id, sheetSnapshotAt: new Date() });

    // AG-C0001 goes onto Kashif's van: X1 on his run, loaded at Ahmed Gas Store.
    const cylinder = await db().cylinder.findFirstOrThrow({ where: { distributorId: people.DA.distributorId, shortNo: 1 }, select: { id: true, qrCode: true } });
    const assigned = await api().post(`${API}/orders/${x1.body.id}/assign-driver`).set(authHeader(people.SA1)).send({ driverId: people.DR1.driverId }).expect(200);
    const pickup = await db().tripStop.findFirstOrThrow({ where: { tripId: assigned.body.tripId, stopType: 'STORE_PICKUP' }, select: { id: true } });
    await scanCalls(app).tripScan(people.DR1, assigned.body.tripId, { stopId: pickup.id, action: 'LOAD', code: cylinder.qrCode }).expect(201);

    const agCylinders = await db().cylinder.findMany({ where: { distributorId: people.DA.distributorId }, select: { id: true, qrCode: true } });
    rows = {
      people,
      x1: x1.body.id,
      topupId: topup.body.id,
      refillId: refill.id,
      c1: people.C1.id,
      cylinder,
      marks: [
        people.DA.distributorId,
        people.DA.homeStoreId,
        x1.body.id,
        topup.body.id,
        refill.id,
        people.C1.id,
        people.C2.id,
        'Ahmed Gas',
        'AG-',
        ...agCylinders.flatMap((row) => [row.id, row.qrCode]),
      ],
    };
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    removeScratchDir(dir);
  });

  const asBilal = (): TestActor => rows.people.DB;

  it('SET-012 Bilal Gas gets 404 for every Ahmed Gas row, exactly as for an unknown id', async () => {
    const unknown = randomUUID();
    const pairs: Array<[string, string, string]> = [
      ['order', `${API}/orders/${rows.x1}`, `${API}/orders/${unknown}`],
      ['tracking', `${API}/orders/${rows.x1}/tracking`, `${API}/orders/${unknown}/tracking`],
      ['top-up AG-T001', `${API}/payments/${rows.topupId}`, `${API}/payments/${unknown}`],
      ['refill AG-R001', `${API}/filling-orders/${rows.refillId}`, `${API}/filling-orders/${unknown}`],
      ['addresses of C1', `${API}/clients/${rows.c1}/addresses`, `${API}/clients/${unknown}/addresses`],
      ['AG-C0001 history by number', `${API}/cylinders/AG-C0001/history`, `${API}/cylinders/AG-C9999/history`],
      ['AG-C0001 by its QR value', `${API}/cylinders/by-qr/${encodeURIComponent(rows.cylinder.qrCode)}`, `${API}/cylinders/by-qr/STD_11_8KG-00000000`],
      ['AG-C0001 custody history', `${API}/custody/cylinders/${rows.cylinder.id}/history`, `${API}/custody/cylinders/${unknown}/history`],
    ];
    for (const [what, theirs, nobodys] of pairs) {
      const leak = await api().get(theirs).set(authHeader(asBilal()));
      const none = await api().get(nobodys).set(authHeader(asBilal()));
      const expectedCode = what === 'addresses of C1' ? 'CLIENT_NOT_FOUND' : 'NOT_FOUND';
      expect({ what, status: leak.status, code: leak.body?.code }).toEqual({ what, status: 404, code: expectedCode });
      expect({ what, ...refusal(leak) }).toEqual({ what, ...refusal(none) });
      // The envelope's `path` repeats the URL the caller sent; nothing else may name an Ahmed Gas row.
      const { path: _sent, ...body } = (leak.body ?? {}) as Record<string, unknown>;
      for (const mark of rows.marks) expect({ what, leaked: JSON.stringify(body).includes(mark) ? mark : null }).toEqual({ what, leaked: null });
    }
  });

  it('SET-012 every Bilal Gas list holds only Bilal Gas rows', async () => {
    const lists = [
      `${API}/orders`,
      `${API}/clients`,
      `${API}/payments/mine`,
      `${API}/filling-orders/mine`,
      `${API}/wallet/statement`,
      `${API}/store/stock`,
      `${API}/store/incoming`,
    ];
    for (const url of lists) {
      const res = await api().get(url).set(authHeader(asBilal()));
      expect({ url, status: res.status }).toEqual({ url, status: 200 });
      const body = JSON.stringify(res.body);
      for (const mark of rows.marks) expect({ url, leaked: body.includes(mark) ? mark : null }).toEqual({ url, leaked: null });
    }
    const clients = await api().get(`${API}/clients`).set(authHeader(asBilal())).expect(200);
    expect((clients.body as Array<{ name: string }>).map((client) => client.name)).toEqual(['Hina']);
  });

  it('SET-012 the Bilal Gas day-end list holds no Ahmed Gas day', async () => {
    const res = await api().get(`${API}/day-end`).set(authHeader(asBilal())).expect(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('2026-10-21');
    for (const mark of rows.marks) expect(body.includes(mark) ? mark : null).toBeNull();
  });

  it('SET-012 Bilal Gas can order for, cancel or scan nothing of Ahmed Gas', async () => {
    const balance = async () => (await db().distributor.findUniqueOrThrow({ where: { id: rows.people.DB.distributorId }, select: { advanceBalancePaisa: true } })).advanceBalancePaisa;
    expect(await balance()).toBe(0n);
    const ordersBefore = await db().order.count();
    const x1Before = await db().order.findUniqueOrThrow({ where: { id: rows.x1 } });

    // Step 3: an order for Sana is refused as an unknown customer; nothing is created or deducted. The
    // body needs a place (createOrderSchema: an addressId or a deliveryLocation), so it names a pin in
    // South, where Bilal Gas has a price: the customer is the only thing wrong with it.
    const order = await api()
      .post(`${API}/orders`)
      .set(authHeader(asBilal()))
      .set('Idempotency-Key', randomUUID())
      .send({
        clientId: rows.c1,
        deliveryLocation: POINTS.south,
        deliveryLabel: 'Test',
        lines: [{ cylinderTypeId: rows.people.sizes.kg11_8, fullCount: 1, expectedReturnCount: 1 }],
      });
    expect({ status: order.status, code: order.body.code }).toEqual({ status: 404, code: 'CLIENT_NOT_FOUND' });
    expect(await db().order.count()).toBe(ordersBefore);
    expect(await balance()).toBe(0n);
    expect(await db().ledgerEntry.count({ where: { distributorId: rows.people.DB.distributorId } })).toBe(0);

    // Step 4: X1 can't be cancelled by Bilal Gas, and stays as it was.
    const cancel = await api().post(`${API}/orders/${rows.x1}/cancel`).set(authHeader(asBilal())).send({ reasonCode: 'OTHER', note: 'Not mine' });
    expect(cancel.status).toBe(404);
    expect(await db().order.findUniqueOrThrow({ where: { id: rows.x1 } })).toEqual(x1Before);

    // Step 5: AG-C0001, on Kashif's van, can't be received by Bilal Gas's store.
    const holderBefore = await db().cylinder.findUniqueOrThrow({ where: { id: rows.cylinder.id }, select: { custodyType: true, custodyId: true, lastEventId: true } });
    expect(holderBefore.custodyType).toBe('VEHICLE');
    const scan = await scanCalls(app).storeScan(asBilal(), { code: rows.cylinder.qrCode });
    expect({ status: scan.status, code: scan.body.code }).toEqual({ status: 409, code: 'SCAN_WRONG_OWNER' });
    expect(await db().cylinder.findUniqueOrThrow({ where: { id: rows.cylinder.id }, select: { custodyType: true, custodyId: true, lastEventId: true } })).toEqual(holderBefore);
  });
});
