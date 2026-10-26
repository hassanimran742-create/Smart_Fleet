/**
 * FND-019 to FND-022: the Idempotency-Key rules of API_CONTRACT §4.2 on the real create routes (orders,
 * top-up requests and expenses).
 */
import type { INestApplication } from '@nestjs/common';
import { localDate } from '@smartfleet/shared-utils';
import { systemActor } from '../../src/common/auth/actor';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb, walletMismatches } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http as client } from '../helpers/http';
import { createStandardData, DUMMY_COMPANY_ACCOUNT, x1OrderBody, x2OrderBody, type StandardData } from '../helpers/standard-data';

const K1 = '11111111-aaaa-4aaa-8aaa-000000000001';
const K2 = '11111111-aaaa-4aaa-8aaa-000000000002';
const K4 = '11111111-aaaa-4aaa-8aaa-000000000004';
const K5 = '11111111-aaaa-4aaa-8aaa-000000000005';

function key(n: number): string {
  return `22222222-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`;
}

describeDb('foundation: idempotency keys on the create routes', () => {
  let app: INestApplication;
  let std: StandardData;

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

  const http = () => client(app);
  const shop = () => authHeader(std.DA.actor);
  const office = () => authHeader(std.SA1.actor);
  const db = () => getTestPrisma();

  function placeX1(idempotencyKey: string) {
    return http().post('/api/v1/orders').set(shop()).set('Idempotency-Key', idempotencyKey).send(x1OrderBody(std));
  }

  function correct(idempotencyKey: string, body: Record<string, unknown>) {
    return http()
      .post(`/api/v1/admin/distributors/${std.DA.id}/wallet/corrections`)
      .set(office())
      .set('Idempotency-Key', idempotencyKey)
      .send(body);
  }

  async function balanceOf(distributorId: string): Promise<bigint> {
    return (await db().distributor.findUniqueOrThrow({ where: { id: distributorId } })).advanceBalancePaisa;
  }

  it("FND-019 a request that failed doesn't use up its Idempotency-Key (example X4)", async () => {
    await correct(key(1), { direction: 'TAKE', amountPaisa: 452100, reasonCode: 'OTHER', note: 'Set up example X4' }).expect(201);
    expect(await balanceOf(std.DA.id)).toBe(24_900n);
    const ledgerBefore = await db().ledgerEntry.count();

    // Step 1.
    const short = await placeX1(K5).expect(409);
    expect(short.body).toMatchObject({
      code: 'WALLET_INSUFFICIENT_BALANCE',
      details: { requiredPaisa: '25000', balancePaisa: '24900', shortByPaisa: '100' },
      message: 'Not enough balance. This needs Rs 250 and you have Rs 249. Add money to continue.',
    });
    expect(await db().order.count()).toBe(0);
    expect(await db().ledgerEntry.count()).toBe(ledgerBefore);
    // Step 2.
    await correct(key(2), { direction: 'ADD', amountPaisa: 100, reasonCode: 'OTHER', note: 'Complete example X4' }).expect(201);
    expect(await balanceOf(std.DA.id)).toBe(25_000n);
    // Step 3: a new order, not a replay.
    const placed = await placeX1(K5).expect(201);
    expect(placed.headers['idempotent-replay']).toBeUndefined();
    const debits = await db().ledgerEntry.findMany({ where: { entryType: 'DEBIT_ORDER', distributorId: std.DA.id } });
    expect(debits.map((row) => row.amountPaisa)).toEqual([-25_000n]);
    expect(await balanceOf(std.DA.id)).toBe(0n);
    // Step 4.
    const replay = await placeX1(K5).expect(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.body.id).toBe(placed.body.id);
    expect(await balanceOf(std.DA.id)).toBe(0n);
  });

  it('FND-020 the same Idempotency-Key with a different body is refused with IDEMPOTENCY_CONFLICT', async () => {
    await app.get(SettingsService).set('topup.account', DUMMY_COMPANY_ACCOUNT, systemActor('cli:settings'), 'Rehearsal company account', {
      allowNotEditable: true,
    });
    const petrol = await db().expenseType.findUniqueOrThrow({ where: { code: 'PETROL' } });
    const expense = {
      expenseDate: localDate(new Date()),
      amountPaisa: 150000,
      typeId: petrol.id,
      vehicleId: std.DR1.vehicleId,
      description: 'Petrol for LEA-101',
    };
    const topup = { amountPaisa: 500000, payerName: 'Ahmed Gas', payerChannel: 'BANK_APP' };
    // Before: X1 with K1, a Rs 5,000 top-up request with K2, a Rs 1,500 expense with K4.
    const x1 = await placeX1(K1).expect(201);
    await http().post('/api/v1/payments/topup-requests').set(shop()).set('Idempotency-Key', K2).send(topup).expect(201);
    await http().post('/api/v1/expenses').set(office()).set('Idempotency-Key', K4).send(expense).expect(201);

    // Steps 1–4.
    const conflicts = [
      http().post('/api/v1/orders').set(shop()).set('Idempotency-Key', K1).send(x2OrderBody(std)),
      http()
        .post('/api/v1/orders')
        .set(shop())
        .set('Idempotency-Key', K1)
        .send({ ...x1OrderBody(std), lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 3, expectedReturnCount: 3 }] }),
      http().post('/api/v1/payments/topup-requests').set(shop()).set('Idempotency-Key', K2).send({ ...topup, amountPaisa: 1000000 }),
      http().post('/api/v1/expenses').set(office()).set('Idempotency-Key', K4).send({ ...expense, amountPaisa: 200000 }),
    ];
    for (const request of conflicts) {
      const res = await request.expect(409);
      expect(res.body).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', message: 'This was already sent with different details. Start again.' });
    }
    // Step 5.
    const malformed = await http().post('/api/v1/orders').set(shop()).set('Idempotency-Key', 'not-a-uuid').send(x2OrderBody(std)).expect(400);
    expect(malformed.body.code).toBe('VALIDATION_FAILED');
    expect(malformed.body.details.fields[0]).toMatchObject({ path: 'Idempotency-Key', code: 'INVALID_ID' });
    // Step 6.
    expect(await balanceOf(std.DA.id)).toBe(475_000n);
    const orders = await db().order.findMany({ include: { lines: true } });
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe(x1.body.id);
    expect(orders[0].lines.map((line) => [line.cylinderTypeId, line.fullCount]).sort()).toEqual(
      [
        [std.sizes.kg11_8, 2],
        [std.sizes.kg45_4, 1],
      ].sort(),
    );
    expect(orders[0].deliveryFeePaisa).toBe(25_000n);
    expect(await db().payment.count({ where: { distributorId: std.DA.id } })).toBe(1);
    const expenses = await db().expense.findMany();
    expect(expenses.map((row) => row.amountPaisa)).toEqual([150_000n]);
    expect(await db().ledgerEntry.count({ where: { entryType: 'DEBIT_ORDER' } })).toBe(1);
  });

  it('FND-021 two requests with the same key at the same moment make one order and one deduction', async () => {
    for (let run = 1; run <= 10; run++) {
      const sameKey = key(100 + run);
      const [a, b] = await Promise.all([placeX1(sameKey), placeX1(sameKey)]);
      const statuses = [a.status, b.status].sort();
      expect({ run, statuses }).toEqual({ run, statuses: [200, 201] });
      expect(a.body.id).toBe(b.body.id);
      const replay = a.status === 200 ? a : b;
      expect(replay.headers['idempotent-replay']).toBe('true');
      expect(await db().order.count({ where: { clientRequestId: sameKey } })).toBe(1);
      expect(await db().ledgerEntry.count({ where: { orderId: a.body.id, entryType: 'DEBIT_ORDER' } })).toBe(1);
      expect(await walletMismatches()).toEqual([]);
    }
    expect(await balanceOf(std.DA.id)).toBe(20_000n);
  });

  it('FND-022 idempotency keys belong to one distributor, so another distributor never gets a replay', async () => {
    // Before: DA placed X1 with K1; DB has Rs 500.
    const first = await placeX1(K1).expect(201);
    await db().$transaction([
      db().distributor.update({ where: { id: std.DB.id }, data: { advanceBalancePaisa: 50_000n } }),
      db().ledgerEntry.create({
        data: {
          distributorId: std.DB.id,
          entryType: 'CREDIT_TOPUP',
          amountPaisa: 50_000n,
          balanceAfterPaisa: 50_000n,
          idempotencyKey: `test-topup:${std.DB.id}`,
        },
      }),
    ]);
    // Step 1: DA's body under DA's key, sent by DB.
    const foreign = await http().post('/api/v1/orders').set(authHeader(std.DB.actor)).set('Idempotency-Key', K1).send(x1OrderBody(std)).expect(404);
    expect(foreign.body).toMatchObject({ code: 'CLIENT_NOT_FOUND', message: "We couldn't find this customer." });
    expect(foreign.headers['idempotent-replay']).toBeUndefined();
    expect(JSON.stringify(foreign.body)).not.toContain(first.body.id);
    // Step 2: DB's own order under the same key.
    const own = await http()
      .post('/api/v1/orders')
      .set(authHeader(std.DB.actor))
      .set('Idempotency-Key', K1)
      .send({
        clientId: std.C3.id,
        addressId: std.C3.addressId,
        deliveryLabel: "Hina's house",
        lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 1, expectedReturnCount: 1 }],
      })
      .expect(201);
    expect(own.body.shortCode).toMatch(/^BG-/);
    expect(own.body.fee.totalPaisa).toBe('30000');
    expect(await balanceOf(std.DB.id)).toBe(20_000n);
    // Step 3.
    const replay = await placeX1(K1).expect(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.shortCode).toMatch(/^AG-/);
    expect(await balanceOf(std.DA.id)).toBe(475_000n);
  });

  it('starts from the standard data: Ahmed Gas with Rs 5,000 and a consistent wallet', async () => {
    expect(std.DA.code).toBe('AG');
    expect(await balanceOf(std.DA.id)).toBe(500_000n);
    expect(await walletMismatches()).toEqual([]);
  });
});
