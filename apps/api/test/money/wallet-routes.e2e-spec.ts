/**
 * Wallet routes (API_CONTRACT §7.8): the shop's summary and history, the compatibility ledger routes,
 * and the office's wallet list, wallet page and full history. WAL-001, WAL-004, WAL-005, WAL-007,
 * WAL-008, WAL-019 and the wallet side of FEE-001.
 */
import type { INestApplication } from '@nestjs/common';
import { businessDate } from '@smartfleet/shared-utils';
import { userActor } from '../../src/common/auth/actor';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb, walletMismatches } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http as client, type TestResponse } from '../helpers/http';
import { createStandardData, x1OrderBody, type StandardData } from '../helpers/standard-data';
import { balanceOf, insertOrder, key, minutesAgo, seedTopup, setCompanyAccount } from './money-fixtures';

/** Every `*Paisa` value in a JSON body is a digit string, signed only by a leading "-"; null only where allowed. */
function expectPaisaStrings(value: unknown, nullable: readonly string[] = [], path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => expectPaisaStrings(item, nullable, `${path}[${i}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const at = `${path}.${k}`;
    if (k.endsWith('Paisa') && Array.isArray(v)) {
      for (const item of v) expect({ at, item }).toEqual({ at, item: expect.stringMatching(/^\d+$/) });
      continue;
    }
    if (k.endsWith('Paisa')) {
      if (v === null) expect({ at, nullAllowed: nullable.includes(k) }).toEqual({ at, nullAllowed: true });
      else expect({ at, v }).toEqual({ at, v: expect.stringMatching(/^-?\d+$/) });
      continue;
    }
    expectPaisaStrings(v, nullable, at);
  }
}

describeDb('money: wallet routes', () => {
  let app: INestApplication;
  let std: StandardData;
  const db = () => getTestPrisma();
  const http = () => client(app);

  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
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

  const shop = () => authHeader(std.DA.actor);
  const office = () => authHeader(std.SA1.actor);

  function correction(distributorId: string, body: Record<string, unknown>, idempotencyKey: string, who = office()) {
    return http()
      .post(`/api/v1/admin/distributors/${distributorId}/wallet/corrections`)
      .set(who)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);
  }

  function topupRequest(amountPaisa: unknown, idempotencyKey: string) {
    return http()
      .post('/api/v1/payments/topup-requests')
      .set(shop())
      .set('Idempotency-Key', idempotencyKey)
      .send({ amountPaisa, payerName: 'Ahmed Raza', payerChannel: 'BANK_APP' });
  }

  /** X1's money without the orders lane: an order row and its deduction through WalletService. */
  async function placeX1ByService(): Promise<{ id: string; orderNo: number }> {
    const order = await insertOrder({ distributor: std.DA, client: std.C1, zoneId: std.zones.North.id });
    await db().$transaction((tx) =>
      app.get(WalletService).debit(tx, {
        distributorId: std.DA.id,
        subject: { type: 'ORDER', orderId: order.id },
        amountPaisa: 48_000n,
        actor: userActor(std.DA.actor),
      }),
    );
    return order;
  }

  it('WAL-001 the wallet summary shows the balance and the money being checked, which never changes the balance', async () => {
    const first = await http().get('/api/v1/wallet').set(shop()).expect(200);
    expect(first.body).toEqual({ balancePaisa: '500000', pendingTopupPaisa: '0', pendingTopupCount: 0, lowBalance: false, capPaisa: null });
    expectPaisaStrings(first.body, ['capPaisa']);

    await setCompanyAccount(app);
    const ledgerBefore = await db().ledgerEntry.count();
    await topupRequest(200000, key('1', 1)).expect(201);
    await topupRequest(300000, key('1', 2)).expect(201);

    const after = await http().get('/api/v1/wallet').set(shop()).expect(200);
    expect(after.body).toEqual({ balancePaisa: '500000', pendingTopupPaisa: '500000', pendingTopupCount: 2, lowBalance: false, capPaisa: null });
    expect(await db().ledgerEntry.count()).toBe(ledgerBefore);
  });

  it('WAL-001 GET /distributor/home returns the same WalletSummary under wallet', async () => {
    await setCompanyAccount(app);
    await topupRequest(200000, key('1', 3)).expect(201);
    const wallet = await http().get('/api/v1/wallet').set(shop()).expect(200);
    const home = await http().get('/api/v1/distributor/home').set(shop()).expect(200);
    expect(home.body.wallet).toEqual(wallet.body);
  });

  it('WAL-004 the low-balance flag is true only strictly below wallet.lowBalancePaisa, and follows the setting at once', async () => {
    /** The office's Wallets list carries the same flag as the shop's summary (UX pass 2026-10-23). */
    const officeFlags = async (): Promise<Record<string, boolean>> => {
      const rows = (await http().get('/api/v1/admin/wallets').set(office()).expect(200)).body as Array<{ code: string; lowBalance: boolean }>;
      return Object.fromEntries(rows.map((row) => [row.code, row.lowBalance]));
    };
    // Step 1: Rs 0 is below Rs 1,000.
    expect((await http().get('/api/v1/wallet').set(authHeader(std.DB.actor)).expect(200)).body.lowBalance).toBe(true);
    expect(await officeFlags()).toEqual({ AG: false, BG: true });
    // Step 2: exactly Rs 1,000 is not low.
    await correction(std.DA.id, { direction: 'TAKE', amountPaisa: 400000, reasonCode: 'OTHER', note: 'test setup low balance' }, key('4', 1)).expect(201);
    expect((await http().get('/api/v1/wallet').set(shop()).expect(200)).body).toMatchObject({ balancePaisa: '100000', lowBalance: false });
    expect(await officeFlags()).toEqual({ AG: false, BG: true });
    // Step 3: Rs 999 is low.
    await correction(std.DA.id, { direction: 'TAKE', amountPaisa: 100, reasonCode: 'OTHER', note: 'test setup low balance 2' }, key('4', 2)).expect(201);
    expect((await http().get('/api/v1/wallet').set(shop()).expect(200)).body).toMatchObject({ balancePaisa: '99900', lowBalance: true });
    expect(await officeFlags()).toEqual({ AG: true, BG: true });
    // Step 4: the threshold at Rs 500 applies to the very next request.
    await http()
      .patch('/api/v1/settings/wallet.lowBalancePaisa')
      .set(office())
      .send({ value: 50000, reason: 'test lower warning' })
      .expect(200);
    expect((await http().get('/api/v1/wallet').set(shop()).expect(200)).body.lowBalance).toBe(false);
    expect(await officeFlags()).toEqual({ AG: false, BG: true });
    const updates = await db().auditLog.findMany({ where: { action: 'setting.update' } });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ actorUserId: std.SA1.id, reason: 'test lower warning' });
    expect(updates[0].diff).toMatchObject({ key: 'wallet.lowBalancePaisa', from: 100000, to: 50000 });
    // Step 5.
    const config = await http().get('/api/v1/app/config').expect(200);
    expect(config.body.wallet.lowBalancePaisa).toBe('50000');
    // A threshold of Rs 0 never warns, not even at a balance of Rs 0.
    await http().patch('/api/v1/settings/wallet.lowBalancePaisa').set(office()).send({ value: 0, reason: 'warning switched off' }).expect(200);
    expect((await http().get('/api/v1/wallet').set(authHeader(std.DB.actor)).expect(200)).body).toMatchObject({ balancePaisa: '0', lowBalance: false });
    expect(await officeFlags()).toEqual({ AG: false, BG: false });
    await http().patch('/api/v1/settings/wallet.lowBalancePaisa').set(office()).send({ value: 100000, reason: 'back to the default' }).expect(200);
  });

  it('WAL-005 the wallet history maps every ledger row to a plain kind, newest first, filtered by one kind or a list', async () => {
    // Opening +5,050, then an old refill debit -50 with no reason: Rs 5,000.
    const opening = await db().ledgerEntry.findFirstOrThrow({ where: { distributorId: std.DA.id } });
    const t0 = Date.now() - 60 * 60_000;
    await db().ledgerEntry.update({
      where: { id: opening.id },
      data: { amountPaisa: 505_000n, balanceAfterPaisa: 505_000n, createdAt: new Date(t0) },
    });
    await db().ledgerEntry.create({
      data: {
        distributorId: std.DA.id,
        entryType: 'ADJUSTMENT',
        amountPaisa: -5_000n,
        balanceAfterPaisa: 500_000n,
        idempotencyKey: `legacy:${key('5', 9)}`,
        note: 'refill',
        createdAt: new Date(t0 + 60_000),
      },
    });
    // A top-up of Rs 2,000 approved against the bank (AG-T001).
    await setCompanyAccount(app);
    const request = await topupRequest(200000, key('5', 1)).expect(201);
    expect(request.body.shortCode).toBe('AG-T001');
    await http()
      .post(`/api/v1/payments/${request.body.id}/approve`)
      .set(office())
      .send({ bankReference: 'FT-5005-0001', bankAmountPaisa: 200000, bankTime: minutesAgo(5) })
      .expect(200);
    // X1 placed and cancelled before loading (the wallet's side of it).
    const x1 = await placeX1ByService();
    await db().$transaction((tx) =>
      app.get(WalletService).reverse(tx, { subject: { type: 'ORDER', orderId: x1.id }, actor: userActor(std.DA.actor), reason: 'Customer cancelled' }),
    );
    // A correction.
    await correction(std.DA.id, { direction: 'TAKE', amountPaisa: 10000, reasonCode: 'SYSTEM_ERROR', note: 'Duplicate test correction' }, key('5', 2)).expect(201);

    // Step 1.
    const all = await http().get('/api/v1/wallet/statement').set(shop()).expect(200);
    const items = all.body.items as Array<Record<string, unknown>>;
    expect(items.map((i) => [i.kind, i.amountPaisa, i.balanceAfterPaisa, i.reasonCode])).toEqual([
      ['CORRECTION', '-10000', '690000', 'SYSTEM_ERROR'],
      ['DELIVERY_COST_RETURNED', '48000', '700000', null],
      ['DELIVERY_COST', '-48000', '652000', null],
      ['TOPUP_ADDED', '200000', '700000', null],
      ['LEGACY', '-5000', '500000', null],
      ['OPENING_BALANCE', '505000', '505000', 'OPENING_BALANCE'],
    ]);
    const x1Subject = { type: 'ORDER', id: x1.id, shortCode: 'AG-0001', clientName: 'Sana' };
    expect(items[0].subject).toBeNull();
    expect(items[1].subject).toEqual(x1Subject);
    expect(items[2].subject).toEqual(x1Subject);
    expect(items[3].subject).toEqual({ type: 'TOPUP', id: request.body.id, shortCode: 'AG-T001', clientName: null });
    expect(all.body.nextCursor).toBeNull();
    for (const item of items) {
      expect(item).not.toHaveProperty('note');
      expect(item).not.toHaveProperty('by');
      if (item.subject) expect(item.subject).not.toHaveProperty('bankReference');
      expect(item.kind).not.toBe('REFILL_DELIVERY_COST');
    }
    // Step 2.
    const costs = await http().get('/api/v1/wallet/statement?kind=DELIVERY_COST').set(shop()).expect(200);
    expect((costs.body.items as Array<{ kind: string }>).map((i) => i.kind)).toEqual(['DELIVERY_COST']);
    // Step 3: the office view adds notes, authors and the typed bank reference.
    const officeView = await http().get(`/api/v1/admin/distributors/${std.DA.id}/wallet/statement`).set(office()).expect(200);
    const officeItems = officeView.body.items as Array<Record<string, any>>;
    expect(officeItems.map((i) => i.id)).toEqual(items.map((i) => i.id));
    expect(officeItems[0]).toMatchObject({ kind: 'CORRECTION', note: 'Duplicate test correction', by: { name: 'Owner' } });
    expect(officeItems[3].subject).toEqual({ type: 'TOPUP', id: request.body.id, shortCode: 'AG-T001', clientName: null, bankReference: 'FT-5005-0001' });
    for (const item of officeItems) {
      expect(item).toHaveProperty('note');
      expect(item).toHaveProperty('by');
    }
    // Step 4.
    const pair = await http().get('/api/v1/wallet/statement?kind=DELIVERY_COST,DELIVERY_COST_RETURNED').set(shop()).expect(200);
    expect((pair.body.items as Array<{ kind: string }>).map((i) => i.kind)).toEqual(['DELIVERY_COST_RETURNED', 'DELIVERY_COST']);
    // Step 5.
    for (const bad of ['FOO', 'DELIVERY_COST,DELIVERY_COST']) {
      const res = await http().get(`/api/v1/wallet/statement?kind=${bad}`).set(shop()).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect((res.body.details.fields as Array<{ path: string }>).map((f) => f.path)).toContain('kind');
    }
    expect(await walletMismatches()).toEqual([]);
  });

  it('WAL-005 the date filter takes business dates (whole business days) or instants (inclusive)', async () => {
    const opening = await db().ledgerEntry.findFirstOrThrow({ where: { distributorId: std.DA.id } });
    const at = opening.createdAt.getTime();
    const count = async (query: Record<string, string>) =>
      ((await http().get('/api/v1/wallet/statement').set(shop()).query(query).expect(200)).body.items as unknown[]).length;
    expect(await count({ from: new Date(at).toISOString() })).toBe(1);
    expect(await count({ from: new Date(at + 1).toISOString() })).toBe(0);
    expect(await count({ to: new Date(at).toISOString() })).toBe(1);
    expect(await count({ to: new Date(at - 1).toISOString() })).toBe(0);
    const day = businessDate(opening.createdAt, { timezone: 'Asia/Karachi', cutoffLocalTime: '03:00' });
    expect(await count({ from: day, to: day })).toBe(1);
    expect(await count({ from: '2020-01-01' })).toBe(1);
    expect(await count({ to: '2020-01-01' })).toBe(0);
    await http().get('/api/v1/wallet/statement').set(shop()).query({ from: 'yesterday' }).expect(400);
  });

  it('WAL-007 only the owning distributor reads a wallet; other roles and other shops are refused', async () => {
    await placeX1ByService();
    const daBalance = await balanceOf(std.DA.id);
    const other = authHeader(std.DB.actor);
    // Step 1: DB only ever gets its own data.
    expect((await http().get('/api/v1/wallet').set(other).expect(200)).body.balancePaisa).toBe('0');
    expect((await http().get('/api/v1/wallet/statement').set(other).expect(200)).body.items).toEqual([]);
    expect((await http().get(`/api/v1/wallet/statement?distributorId=${std.DA.id}`).set(other).expect(200)).body.items).toEqual([]);
    expect((await http().get('/api/v1/ledger/balance').set(other).expect(200)).body).toEqual({ balancePaisa: '0', pendingTopupPaisa: '0' });
    expect((await http().get('/api/v1/ledger/me').set(other).expect(200)).body).toEqual([]);
    // Steps 2 and 3: distributor-only routes have no office bypass.
    for (const [who, url] of [
      [office(), '/api/v1/wallet'],
      [office(), '/api/v1/wallet/statement'],
      [authHeader(std.DR1.actor), '/api/v1/wallet'],
    ] as const) {
      const res = await http().get(url).set(who).expect(403);
      expect(res.body).toMatchObject({ code: 'PERMISSION_DENIED', message: "Your account can't do this." });
    }
    // Steps 4 and 5: office routes refuse the shops and the driver.
    for (const who of [shop(), other, authHeader(std.DR1.actor)]) {
      await http().get('/api/v1/admin/wallets').set(who).expect(403);
      await http().get(`/api/v1/admin/distributors/${std.DA.id}/wallet`).set(who).expect(403);
      await http().get(`/api/v1/admin/distributors/${std.DA.id}/wallet/statement`).set(who).expect(403);
      const res = await correction(std.DA.id, { direction: 'ADD', amountPaisa: 100000, reasonCode: 'OTHER', note: 'self top up attempt' }, key('7', 1), who);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PERMISSION_DENIED');
    }
    expect(await db().ledgerEntry.count({ where: { entryType: 'ADJUSTMENT', reasonCode: 'OTHER' } })).toBe(0);
    expect(await balanceOf(std.DA.id)).toBe(daBalance);
    await http().get('/api/v1/wallet').expect(401);
  });

  it('WAL-008 the office wallet list, the live integrity check and the full history without a row cap', async () => {
    await setCompanyAccount(app);
    const pending = await topupRequest(200000, key('8', 1)).expect(201);
    // Step 1.
    const list = await http().get('/api/v1/admin/wallets').set(office()).expect(200);
    expect(list.body).toEqual([
      { distributorId: std.DA.id, businessName: 'Ahmed Gas', code: 'AG', balancePaisa: '500000', lowBalance: false, checkingPaisa: '200000', checkingCount: 1, lastTopupAt: null },
      { distributorId: std.DB.id, businessName: 'Bilal Gas', code: 'BG', balancePaisa: '0', lowBalance: true, checkingPaisa: '0', checkingCount: 0, lastTopupAt: null },
    ]);
    // Step 2.
    const detail = await http().get(`/api/v1/admin/distributors/${std.DA.id}/wallet`).set(office()).expect(200);
    expect(detail.body).toMatchObject({
      balancePaisa: '500000',
      pendingTopupPaisa: '200000',
      pendingTopupCount: 1,
      lowBalance: false,
      capPaisa: null,
      integrity: { ok: true, ledgerSumPaisa: '500000', differencePaisa: '0' },
    });
    expect(Math.abs(Date.parse(detail.body.integrity.checkedAt) - Date.now())).toBeLessThan(60_000);
    // Step 3: 250 more rows, from 125 ADD and 125 TAKE corrections of Rs 1.
    const wallet = app.get(WalletService);
    for (let n = 1; n <= 250; n++) {
      await db().$transaction((tx) =>
        wallet.correct(tx, {
          distributorId: std.DA.id,
          direction: n % 2 === 1 ? 'ADD' : 'TAKE',
          amountPaisa: 100n,
          reasonCode: 'OTHER',
          note: `Paging check row ${n}`,
          requestKey: key('9', n),
          actor: userActor(std.SA1.actor),
        }),
      );
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: TestResponse = await http()
        .get(`/api/v1/admin/distributors/${std.DA.id}/wallet/statement`)
        .query(cursor ? { limit: 100, cursor } : { limit: 100 })
        .set(office())
        .expect(200);
      const items = res.body.items as Array<Record<string, unknown>>;
      expect(items.length).toBeLessThanOrEqual(100);
      for (const item of items) {
        expect(item).toHaveProperty('note');
        expect(item).toHaveProperty('by');
        seen.push(item.id as string);
      }
      cursor = res.body.nextCursor;
      pages += 1;
    } while (cursor);
    expect(seen).toHaveLength(251);
    expect(new Set(seen).size).toBe(251);
    expect(pages).toBe(3);
    // Step 4.
    await http().get(`/api/v1/admin/distributors/${key('f', 1)}/wallet`).set(office()).expect(404);
    await http().get('/api/v1/admin/distributors/not-a-uuid/wallet').set(office()).expect(404);
    // Step 5.
    await http()
      .post(`/api/v1/payments/${pending.body.id}/approve`)
      .set(office())
      .send({ bankReference: 'FT-8008-0001', bankAmountPaisa: 200000, bankTime: minutesAgo(3) })
      .expect(200);
    const approved = await db().payment.findUniqueOrThrow({ where: { id: pending.body.id } });
    const afterApproval = (await http().get('/api/v1/admin/wallets').set(office()).expect(200)).body[0];
    expect(afterApproval).toMatchObject({ lastTopupAt: approved.completedAt?.toISOString(), checkingCount: 0, checkingPaisa: '0' });
    // Step 6: a request being checked doesn't move lastTopupAt.
    await topupRequest(100000, key('8', 2)).expect(201);
    const afterRequest = (await http().get('/api/v1/admin/wallets').set(office()).expect(200)).body[0];
    expect(afterRequest).toMatchObject({ lastTopupAt: approved.completedAt?.toISOString(), checkingPaisa: '100000', checkingCount: 1 });
    // Step 7: nothing is clamped, and a strange cursor is refused.
    const url = `/api/v1/admin/distributors/${std.DA.id}/wallet/statement`;
    const tooLarge = await http().get(`${url}?limit=101`).set(office()).expect(400);
    expect(tooLarge.body.details.fields).toEqual([expect.objectContaining({ path: 'limit', code: 'TOO_LARGE' })]);
    const tooSmall = await http().get(`${url}?limit=0`).set(office()).expect(400);
    expect(tooSmall.body.details.fields).toEqual([expect.objectContaining({ path: 'limit', code: 'TOO_SMALL' })]);
    const garbage = await http().get(`${url}?cursor=garbage`).set(office()).expect(400);
    expect(garbage.body.code).toBe('VALIDATION_FAILED');
    expect((garbage.body.details.fields as Array<{ path: string }>).map((f) => f.path)).toEqual(['cursor']);
  }, 180_000);

  it('WAL-019 money travels as integer paisa: digit strings out, an integer or a digit string in', async () => {
    await setCompanyAccount(app);
    await placeX1ByService();
    // Step 1 (the wallet's routes).
    expectPaisaStrings((await http().get('/api/v1/wallet').set(shop()).expect(200)).body, ['capPaisa']);
    const statement = await http().get('/api/v1/wallet/statement').set(shop()).expect(200);
    expectPaisaStrings(statement.body);
    expect((statement.body.items as Array<{ amountPaisa: string }>)[0].amountPaisa).toBe('-48000');
    // Step 2.
    const asNumber = await topupRequest(200000, key('a', 1)).expect(201);
    const asString = await topupRequest('300000', key('a', 2)).expect(201);
    expect([asNumber.body.amountPaisa, asString.body.amountPaisa]).toEqual(['200000', '300000']);
    const stored = await db().payment.findMany({ where: { distributorId: std.DA.id }, orderBy: { requestNo: 'asc' } });
    expect(stored.map((p) => p.amountPaisa)).toEqual([200_000n, 300_000n]);
    expectPaisaStrings((await http().get('/api/v1/payments/mine').set(shop()).expect(200)).body, ['creditedPaisa', 'bankAmountPaisa']);
    // Step 3.
    let n = 10;
    for (const bad of ['5,000', '5000.00', 'Rs 5000', 200000.5, '', '-200000']) {
      const res = await topupRequest(bad, key('a', n++)).expect(400);
      expect({ bad, code: res.body.code, paths: (res.body.details.fields as Array<{ path: string }>).map((f) => f.path) }).toEqual({
        bad,
        code: 'VALIDATION_FAILED',
        paths: ['amountPaisa'],
      });
    }
    expect(await db().payment.count({ where: { distributorId: std.DA.id } })).toBe(2);
    // Step 4.
    expect((await http().get('/api/v1/ledger/balance').set(shop()).expect(200)).body).toEqual({ balancePaisa: '452000', pendingTopupPaisa: '500000' });
    const mine = await http().get('/api/v1/ledger/me').set(shop()).expect(200);
    expect(Array.isArray(mine.body)).toBe(true);
    expect(mine.body.length).toBeLessThanOrEqual(100);
    expectPaisaStrings(mine.body);
    for (const row of mine.body as Array<Record<string, unknown>>) {
      expect(row.distributorId).toBe(std.DA.id);
      expect(row).not.toHaveProperty('note');
      expect(row).not.toHaveProperty('idempotencyKey');
    }
  });

  it('WAL-019 the order and quote routes send money as digit strings too', async () => {
    const placed = await http().post('/api/v1/orders').set(shop()).set('Idempotency-Key', key('b', 1)).send(x1OrderBody(std)).expect(201);
    expectPaisaStrings((await http().get(`/api/v1/orders/${placed.body.id}`).set(shop()).expect(200)).body);
    expectPaisaStrings((await http().get('/api/v1/pricing/quote').query({ lat: 31.53, lng: 74.23 }).set(shop()).expect(200)).body);
    expectPaisaStrings((await http().post('/api/v1/orders/quote').set(shop()).send(x1OrderBody(std)).expect(200)).body);
  });

  it('FEE-001 placing X1 deducts Rs 480 and the wallet history shows it as the newest delivery cost', async () => {
    const placed = await http()
      .post('/api/v1/orders')
      .set(shop())
      .set('Idempotency-Key', key('c', 1))
      .send({ ...x1OrderBody(std), quotedTotalPaisa: '48000' })
      .expect(201);
    expect((await http().get('/api/v1/wallet').set(shop()).expect(200)).body.balancePaisa).toBe('452000');
    const statement = await http().get('/api/v1/wallet/statement').set(shop()).expect(200);
    expect(statement.body.items[0]).toMatchObject({
      kind: 'DELIVERY_COST',
      amountPaisa: '-48000',
      balanceAfterPaisa: '452000',
      subject: { type: 'ORDER', id: placed.body.id, clientName: 'Sana' },
    });
    const debits = await db().ledgerEntry.findMany({ where: { orderId: placed.body.id } });
    expect(debits.map((row) => [row.entryType, row.amountPaisa, row.idempotencyKey])).toEqual([
      ['DEBIT_ORDER', -48_000n, `order:${placed.body.id}:debit`],
    ]);
    expect(await walletMismatches()).toEqual([]);
  });
});
