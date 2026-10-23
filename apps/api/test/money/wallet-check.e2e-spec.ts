/**
 * The nightly wallet check (API_CONTRACT §8.5, DATA_MODEL §3.6) and the money invariants under a burst
 * of parallel actions: WAL-016, WAL-018 and WAL-020.
 */
import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { userActor } from '../../src/common/auth/actor';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { WalletCheckJob } from '../../src/modules/wallet/wallet-check.job';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb, walletMismatches } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http as client } from '../helpers/http';
import { createStandardData, x1OrderBody, x2OrderBody, type StandardData } from '../helpers/standard-data';
import { auditRows, balanceOf, expectRunningBalances, insertOrder, key, minutesAgo, setCompanyAccount } from './money-fixtures';

describeDb('money: the nightly wallet check', () => {
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
    await setCompanyAccount(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  const shop = () => authHeader(std.DA.actor);
  const office = () => authHeader(std.SA1.actor);
  const job = () => app.get(WalletCheckJob);
  const wallet = () => app.get(WalletService);

  function topupRequest(amountPaisa: number, idempotencyKey: string) {
    return http()
      .post('/api/v1/payments/topup-requests')
      .set(shop())
      .set('Idempotency-Key', idempotencyKey)
      .send({ amountPaisa, payerName: 'Ahmed Raza', payerChannel: 'BANK_APP' });
  }

  function approve(paymentId: string, bankReference: string, bankAmountPaisa: number, who = office()) {
    return http().post(`/api/v1/payments/${paymentId}/approve`).set(who).send({ bankReference, bankAmountPaisa, bankTime: minutesAgo(5) });
  }

  function correct(body: Record<string, unknown>, idempotencyKey: string, who = office()) {
    return http()
      .post(`/api/v1/admin/distributors/${std.DA.id}/wallet/corrections`)
      .set(who)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);
  }

  /** An order's money without the orders lane: the order row, then its deduction through WalletService. */
  async function placeByService(amountPaisa: bigint, zoneId = std.zones.North.id): Promise<string> {
    const order = await insertOrder({ distributor: std.DA, client: amountPaisa === 48_000n ? std.C1 : std.C2, zoneId });
    await db().$transaction((tx) =>
      wallet().debit(tx, { distributorId: std.DA.id, subject: { type: 'ORDER', orderId: order.id }, amountPaisa, actor: userActor(std.DA.actor) }),
    );
    return order.id;
  }

  function cancelByService(orderId: string) {
    return db().$transaction((tx) =>
      wallet().reverse(tx, { subject: { type: 'ORDER', orderId }, actor: userActor(std.DA.actor), reason: 'Customer cancelled' }),
    );
  }

  /** A normal day: a top-up approved, X1 placed and cancelled before loading, X2 placed, one correction. */
  async function normalDay(): Promise<void> {
    const request = await topupRequest(200000, key('1', 1)).expect(201);
    await approve(request.body.id, 'FT-1601-0001', 200000).expect(200);
    const x1 = await placeByService(48_000n);
    await cancelByService(x1);
    await placeByService(40_000n, std.zones.South.id);
    await correct({ direction: 'ADD', amountPaisa: 10000, reasonCode: 'SYSTEM_ERROR', note: 'Normal day correction' }, key('1', 2)).expect(201);
  }

  async function mismatchAlerts() {
    return db().alert.findMany({ where: { alertType: 'WALLET_CHECK_MISMATCH' }, orderBy: { createdAt: 'asc' } });
  }

  it('WAL-016 the job is registered nightly on Pakistan time; clean wallets raise nothing and each run is audited', async () => {
    await normalDay();
    // Step 1.
    const cron = app.get(SchedulerRegistry).getCronJob('wallet-nightly-check');
    expect(cron.cronTime.source).toBe('30 3 * * *');
    expect(cron.cronTime.timeZone).toBe('Asia/Karachi');
    const run = await job().run();
    expect(run).toEqual({ checked: 2, mismatches: 0, distributorIds: [], raised: 0 });
    expect(await mismatchAlerts()).toEqual([]);
    const checks = await auditRows('wallet.check');
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ actorKind: 'SYSTEM', actorLabel: 'job:wallet-check', actorUserId: null, resourceType: 'job' });
    expect(checks[0].diff).toEqual({ checked: 2, mismatches: 0, distributorIds: [] });
  });

  it('WAL-016 a mismatch raises one CRITICAL alert per distributor and fixes nothing; the job never resolves an alert', async () => {
    await normalDay();
    const ledgerBefore = await db().ledgerEntry.findMany({ orderBy: { id: 'asc' } });
    const balance = await balanceOf(std.DA.id);
    // Step 2.
    await db().$executeRaw`UPDATE distributors SET advance_balance_paisa = advance_balance_paisa + 12000 WHERE id = ${std.DA.id}::uuid`;
    expect((await job().run()).mismatches).toBe(1);
    let alerts = await mismatchAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ severity: 'CRITICAL', status: 'OPEN', resourceType: 'Distributor', resourceId: std.DA.id });
    expect(alerts[0].context).toEqual({
      balancePaisa: (balance + 12_000n).toString(),
      ledgerSumPaisa: balance.toString(),
      differencePaisa: '12000',
    });
    expect(await balanceOf(std.DA.id)).toBe(balance + 12_000n);
    expect(await db().ledgerEntry.findMany({ orderBy: { id: 'asc' } })).toEqual(ledgerBefore);
    let checks = await auditRows('wallet.check');
    expect(checks[checks.length - 1].diff).toEqual({ checked: 2, mismatches: 1, distributorIds: [std.DA.id] });
    // Step 3: de-duplicated per distributor, and the open alert is left as it is.
    const first = alerts[0];
    await job().run();
    alerts = await mismatchAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].updatedAt).toEqual(first.updatedAt);
    checks = await auditRows('wallet.check');
    expect(checks).toHaveLength(2);
    expect(checks[1].diff).toEqual({ checked: 2, mismatches: 1, distributorIds: [std.DA.id] });
    // An acknowledged alert still counts as unresolved.
    await db().alert.update({ where: { id: first.id }, data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() } });
    expect((await job().run()).raised).toBe(0);
    expect(await mismatchAlerts()).toHaveLength(1);
    await db().alert.update({ where: { id: first.id }, data: { status: 'OPEN', acknowledgedAt: null } });
    // Step 4: put right; the job never resolves the alert.
    await db().$executeRaw`UPDATE distributors SET advance_balance_paisa = advance_balance_paisa - 12000 WHERE id = ${std.DA.id}::uuid`;
    expect((await job().run()).mismatches).toBe(0);
    alerts = await mismatchAlerts();
    expect(alerts.map((a) => a.status)).toEqual(['OPEN']);
    checks = await auditRows('wallet.check');
    expect(checks[checks.length - 1].diff).toEqual({ checked: 2, mismatches: 0, distributorIds: [] });
    // Step 5: the office resolves it; a new break raises a new alert, and the old one stays resolved.
    await http().patch(`/api/v1/alerts/${first.id}/resolve`).set(office()).expect(200);
    await db().$executeRaw`UPDATE distributors SET advance_balance_paisa = advance_balance_paisa + 12000 WHERE id = ${std.DA.id}::uuid`;
    expect((await job().run()).raised).toBe(1);
    alerts = await mismatchAlerts();
    expect(alerts.map((a) => [a.id === first.id, a.status])).toEqual([
      [true, 'RESOLVED'],
      [false, 'OPEN'],
    ]);
    await db().$executeRaw`UPDATE distributors SET advance_balance_paisa = advance_balance_paisa - 12000 WHERE id = ${std.DA.id}::uuid`;
    await db().alert.updateMany({ where: { alertType: 'WALLET_CHECK_MISMATCH', status: 'OPEN' }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
    expect(await walletMismatches()).toEqual([]);
  });

  it('WAL-016 a negative balance is a break even when the history adds up to it', async () => {
    await db().$transaction([
      db().ledgerEntry.create({
        data: {
          distributorId: std.DB.id,
          entryType: 'ADJUSTMENT',
          amountPaisa: -5_000n,
          balanceAfterPaisa: -5_000n,
          idempotencyKey: `legacy:${key('2', 1)}`,
        },
      }),
      db().distributor.update({ where: { id: std.DB.id }, data: { advanceBalancePaisa: -5_000n } }),
    ]);
    const run = await job().run();
    expect(run).toMatchObject({ mismatches: 1, distributorIds: [std.DB.id], raised: 1 });
    const [alert] = await mismatchAlerts();
    expect(alert.context).toEqual({ balancePaisa: '-5000', ledgerSumPaisa: '-5000', differencePaisa: '0' });
  });

  it('WAL-018 a burst of parallel money actions keeps balance, ledger sum and running balances consistent (wallet side)', async () => {
    // Before: five X1 orders (Rs 2,600 left) and three Rs 1,000 top-up requests.
    const x1s: string[] = [];
    for (let i = 0; i < 5; i++) x1s.push(await placeByService(48_000n));
    expect(await balanceOf(std.DA.id)).toBe(260_000n);
    const requests: string[] = [];
    for (let i = 0; i < 3; i++) requests.push((await topupRequest(100000, key('3', i + 1)).expect(201)).body.id);

    // The burst.
    const SA2 = authHeader(std.SA2.actor);
    const results = await Promise.allSettled([
      ...x1s.map((id) => cancelByService(id).then(() => 'cancel')),
      ...requests.map((id, i) => approve(id, `FT-1801-000${i + 1}`, 100000).then((res) => (res.status === 200 ? 'approve' : `approve-${res.status}`))),
      ...Array.from({ length: 10 }, () => placeByService(40_000n, std.zones.South.id).then(() => 'order')),
      ...[1, 2].map((n) =>
        correct({ direction: 'TAKE', amountPaisa: 10000, reasonCode: 'OTHER', note: `Burst take ${n}` }, key('4', n), SA2).then((res) =>
          res.status === 201 ? 'take' : `take-${res.status}`,
        ),
      ),
    ]);
    const done = results.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled').map((r) => r.value);
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    for (const r of refused) expect((r.reason as { code?: string }).code).toBe('WALLET_INSUFFICIENT_BALANCE');
    expect(done.filter((v) => v === 'cancel')).toHaveLength(5);
    expect(done.filter((v) => v === 'approve')).toHaveLength(3);
    const ordersCreated = done.filter((v) => v === 'order').length;
    const takes = done.filter((v) => v === 'take').length;
    for (const v of done) expect(['cancel', 'approve', 'order', 'take']).toContain(v);

    const expected = 260_000n + 240_000n + 300_000n - 40_000n * BigInt(ordersCreated) - 10_000n * BigInt(takes);
    expect(await balanceOf(std.DA.id)).toBe(expected);
    await expectRunningBalances(std.DA.id);
    const count = (entryType: 'DEBIT_ORDER' | 'CREDIT_ORDER_REVERSAL' | 'CREDIT_TOPUP') =>
      db().ledgerEntry.count({ where: { distributorId: std.DA.id, entryType } });
    expect(await count('DEBIT_ORDER')).toBe(5 + ordersCreated);
    expect(await count('CREDIT_ORDER_REVERSAL')).toBe(5);
    expect(await count('CREDIT_TOPUP')).toBe(3);
    expect((await job().run()).mismatches).toBe(0);
  }, 180_000);

  it('WAL-018 a burst of parallel orders, cancels, approvals and corrections over HTTP stays consistent', async () => {
    const x1s: string[] = [];
    for (let i = 0; i < 5; i++) {
      x1s.push((await http().post('/api/v1/orders').set(shop()).set('Idempotency-Key', key('5', i + 1)).send(x1OrderBody(std)).expect(201)).body.id);
    }
    expect(await balanceOf(std.DA.id)).toBe(260_000n);
    const requests: string[] = [];
    for (let i = 0; i < 3; i++) requests.push((await topupRequest(100000, key('6', i + 1)).expect(201)).body.id);
    const SA2 = authHeader(std.SA2.actor);
    const responses = await Promise.all([
      ...x1s.map((id, i) =>
        http().post(`/api/v1/orders/${id}/cancel`).set(shop()).set('Idempotency-Key', key('7', i + 1)).send({ reasonCode: 'CUSTOMER_CANCELLED' }),
      ),
      ...requests.map((id, i) => approve(id, `FT-1802-000${i + 1}`, 100000)),
      ...Array.from({ length: 10 }, (_, i) => http().post('/api/v1/orders').set(shop()).set('Idempotency-Key', key('8', i + 1)).send(x2OrderBody(std))),
      ...[1, 2].map((n) => correct({ direction: 'TAKE', amountPaisa: 10000, reasonCode: 'OTHER', note: `Burst take ${n}` }, key('9', n), SA2)),
    ]);
    for (const res of responses) {
      if (res.status >= 400) expect({ status: res.status, code: res.body.code }).toEqual({ status: 409, code: expect.stringMatching(/^WALLET_/) });
    }
    const created = responses.slice(8, 18).filter((res) => res.status === 201).length;
    const takes = responses.slice(18).filter((res) => res.status === 201).length;
    expect(await balanceOf(std.DA.id)).toBe(260_000n + 240_000n + 300_000n - 40_000n * BigInt(created) - 10_000n * BigInt(takes));
    await expectRunningBalances(std.DA.id);
    expect((await job().run()).mismatches).toBe(0);
  }, 180_000);

  it('WAL-020 after a full day of money, the nightly check is clean: every wallet ok, one clean wallet.check row, no alert', async () => {
    await normalDay();
    // More of the day: DB tops up and the office corrects it; a top-up is rejected.
    const dbShop = authHeader(std.DB.actor);
    const dbRequest = await http()
      .post('/api/v1/payments/topup-requests')
      .set(dbShop)
      .set('Idempotency-Key', key('a', 1))
      .send({ amountPaisa: 300000, payerName: 'Bilal Khan', payerChannel: 'EASYPAISA_APP' })
      .expect(201);
    await approve(dbRequest.body.id, 'EP-2001-0001', 250000).expect(200);
    const rejected = await topupRequest(100000, key('a', 2)).expect(201);
    await http().post(`/api/v1/payments/${rejected.body.id}/reject`).set(office()).send({ reasonCode: 'NOT_IN_BANK' }).expect(200);
    await http()
      .post(`/api/v1/admin/distributors/${std.DB.id}/wallet/corrections`)
      .set(office())
      .set('Idempotency-Key', key('a', 3))
      .send({ direction: 'TAKE', amountPaisa: 50000, reasonCode: 'BANK_REVERSAL', note: 'Bank reversed part of it' })
      .expect(201);

    // Step 1.
    const checks = await wallet().verify();
    expect(checks.every((check) => check.ok)).toBe(true);
    const run = await job().run();
    expect(run).toMatchObject({ mismatches: 0, raised: 0 });
    const rows = await auditRows('wallet.check');
    expect(rows[rows.length - 1].diff).toMatchObject({ mismatches: 0 });
    // Step 2.
    expect(await mismatchAlerts()).toEqual([]);
    // Step 3.
    expect(await walletMismatches()).toEqual([]);
    await expectRunningBalances(std.DA.id);
    await expectRunningBalances(std.DB.id);
  });
});
