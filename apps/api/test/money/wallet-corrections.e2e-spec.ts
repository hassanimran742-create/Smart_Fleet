/**
 * Office wallet corrections (ADR-10, API_CONTRACT §4.2, §7.8): add or take money for a genuine mistake,
 * with a reason and a note, never below zero, never capped, once per Idempotency-Key, audited in the
 * same transaction. WAL-010 to WAL-014, WAL-017 and FEE-002.
 */
import type { INestApplication } from '@nestjs/common';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb, walletMismatches } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http as client } from '../helpers/http';
import { createStandardData, x1OrderBody, type StandardData } from '../helpers/standard-data';
import { auditRows, balanceOf, expectRunningBalances, key, minutesAgo, seedTopup, setCompanyAccount } from './money-fixtures';

describeDb('money: wallet corrections', () => {
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
  });

  afterAll(async () => {
    await app?.close();
  });

  const office = () => authHeader(std.SA1.actor);

  function correct(distributorId: string, body: Record<string, unknown>, idempotencyKey?: string, who = office()) {
    const req = http().post(`/api/v1/admin/distributors/${distributorId}/wallet/corrections`).set(who);
    return (idempotencyKey ? req.set('Idempotency-Key', idempotencyKey) : req).send(body);
  }

  async function counts() {
    return {
      ledger: await db().ledgerEntry.count(),
      audits: await db().auditLog.count({ where: { action: 'wallet.correction' } }),
    };
  }

  it('WAL-010 an office correction adds or takes money, writes one ledger row each and is audited', async () => {
    // DA's Rs 5,000: an opening Rs 3,000 plus an approved top-up AG-T001 of Rs 2,000.
    const opening = await db().ledgerEntry.findFirstOrThrow({ where: { distributorId: std.DA.id } });
    await db().$transaction([
      db().ledgerEntry.update({ where: { id: opening.id }, data: { amountPaisa: 300_000n, balanceAfterPaisa: 300_000n } }),
      db().distributor.update({ where: { id: std.DA.id }, data: { advanceBalancePaisa: 300_000n } }),
    ]);
    await setCompanyAccount(app);
    const request = await http()
      .post('/api/v1/payments/topup-requests')
      .set(authHeader(std.DA.actor))
      .set('Idempotency-Key', key('1', 1))
      .send({ amountPaisa: 200000, payerName: 'Ahmed Raza', payerChannel: 'BANK_APP' })
      .expect(201);
    expect(request.body.shortCode).toBe('AG-T001');
    await http()
      .post(`/api/v1/payments/${request.body.id}/approve`)
      .set(office())
      .send({ bankReference: 'FT-1010-0001', bankAmountPaisa: 200000, bankTime: minutesAgo(10) })
      .expect(200);
    expect(await balanceOf(std.DA.id)).toBe(500_000n);

    const K1 = key('1', 11);
    const K2 = key('1', 12);
    const K4 = key('1', 14);
    // Step 1.
    const add = await correct(std.DA.id, { direction: 'ADD', amountPaisa: 33000, reasonCode: 'SYSTEM_ERROR', note: 'Cost taken twice for one order' }, K1).expect(201);
    expect(add.headers['idempotent-replay']).toBeUndefined();
    expect(add.body.entry).toMatchObject({
      kind: 'CORRECTION',
      amountPaisa: '33000',
      balanceAfterPaisa: '533000',
      reasonCode: 'SYSTEM_ERROR',
      note: 'Cost taken twice for one order',
      by: { name: 'Owner' },
      subject: null,
    });
    expect(add.body.wallet).toMatchObject({ balancePaisa: '533000', pendingTopupPaisa: '0' });
    // Step 2.
    const take = await correct(
      std.DA.id,
      { direction: 'TAKE', amountPaisa: 100000, reasonCode: 'WRONG_TOPUP_APPROVAL', note: 'Top-up approved twice by mistake', relatedPaymentId: request.body.id },
      K2,
    ).expect(201);
    expect(take.body.entry).toMatchObject({
      amountPaisa: '-100000',
      balanceAfterPaisa: '433000',
      subject: { type: 'TOPUP', id: request.body.id, shortCode: 'AG-T001', clientName: null, bankReference: 'FT-1010-0001' },
    });
    expect(take.body.wallet.balancePaisa).toBe('433000');
    // Step 3.
    const openingFix = await correct(std.DA.id, { direction: 'ADD', amountPaisa: 10000, reasonCode: 'OPENING_BALANCE', note: 'Opening entry was Rs 100 short' }, K4).expect(201);
    expect(openingFix.body.entry).toMatchObject({ kind: 'OPENING_BALANCE', reasonCode: 'OPENING_BALANCE', balanceAfterPaisa: '443000' });

    // Step 4: the ledger.
    const rows = await db().ledgerEntry.findMany({ where: { distributorId: std.DA.id, idempotencyKey: { startsWith: 'adjust:' } }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.entryType, r.amountPaisa, r.reasonCode, r.createdByUserId, r.idempotencyKey, r.paymentId])).toEqual([
      ['ADJUSTMENT', 33_000n, 'SYSTEM_ERROR', std.SA1.id, `adjust:${K1}`, null],
      ['ADJUSTMENT', -100_000n, 'WRONG_TOPUP_APPROVAL', std.SA1.id, `adjust:${K2}`, request.body.id],
      ['ADJUSTMENT', 10_000n, 'OPENING_BALANCE', std.SA1.id, `adjust:${K4}`, null],
    ]);
    expect(rows.map((r) => r.note)).toEqual(['Cost taken twice for one order', 'Top-up approved twice by mistake', 'Opening entry was Rs 100 short']);
    // The audit rows.
    const logs = await http().get('/api/v1/audit-logs').query({ action: 'wallet.correction', distributorId: std.DA.id }).set(office()).expect(200);
    expect(logs.body.items).toHaveLength(3);
    const byReason = new Map((logs.body.items as Array<Record<string, any>>).map((row) => [row.reason, row]));
    expect(byReason.get('Cost taken twice for one order')).toMatchObject({
      actor: { kind: 'USER', userId: std.SA1.id },
      distributorId: std.DA.id,
      diff: { before: { balancePaisa: '500000' }, after: { balancePaisa: '533000' }, direction: 'ADD', amountPaisa: '33000', reasonCode: 'SYSTEM_ERROR' },
    });
    expect(byReason.get('Top-up approved twice by mistake')).toMatchObject({
      diff: { before: { balancePaisa: '533000' }, after: { balancePaisa: '433000' }, direction: 'TAKE', relatedPaymentId: request.body.id },
    });
    expect(byReason.get('Opening entry was Rs 100 short')).toMatchObject({ diff: { after: { balancePaisa: '443000' } } });
    expect(await balanceOf(std.DA.id)).toBe(443_000n);
    await expectRunningBalances(std.DA.id);
    expect(await walletMismatches()).toEqual([]);
  });

  it("WAL-011 a correction can't take more than the balance, and a refused one writes nothing", async () => {
    const before = await counts();
    // Step 1.
    const fromEmpty = await correct(std.DB.id, { direction: 'TAKE', amountPaisa: 100, reasonCode: 'OTHER', note: 'test take from empty' }, key('2', 1)).expect(409);
    expect(fromEmpty.body).toMatchObject({
      code: 'WALLET_ADJUST_EXCEEDS_BALANCE',
      details: { balancePaisa: '0' },
      message: "The balance is only Rs 0. You can't take more than that.",
    });
    // Step 2.
    const tooMuch = await correct(std.DA.id, { direction: 'TAKE', amountPaisa: 500100, reasonCode: 'OTHER', note: 'test take too much' }, key('2', 2)).expect(409);
    expect(tooMuch.body).toMatchObject({
      code: 'WALLET_ADJUST_EXCEEDS_BALANCE',
      details: { balancePaisa: '500000' },
      message: "The balance is only Rs 5,000. You can't take more than that.",
    });
    expect(await counts()).toEqual(before);
    // Step 3.
    const all = await correct(std.DA.id, { direction: 'TAKE', amountPaisa: 500000, reasonCode: 'OTHER', note: 'test take everything' }, key('2', 3)).expect(201);
    expect(all.body.wallet.balancePaisa).toBe('0');
    // Step 4.
    const more = await correct(std.DA.id, { direction: 'TAKE', amountPaisa: 100, reasonCode: 'OTHER', note: 'test take one more' }, key('2', 4)).expect(409);
    expect(more.body.details).toEqual({ balancePaisa: '0' });
    expect(await counts()).toEqual({ ledger: before.ledger + 1, audits: before.audits + 1 });
    expect(await balanceOf(std.DA.id)).toBe(0n);
    expect(await balanceOf(std.DB.id)).toBe(0n);
  });

  it('WAL-012 correction input is validated: amount, whole rupees, reason, note and related records', async () => {
    const before = await counts();
    let n = 1;
    const send = (body: Record<string, unknown>, distributorId = std.DA.id) => correct(distributorId, body, key('3', n++));
    const base = { direction: 'ADD', amountPaisa: 33000, reasonCode: 'OTHER', note: 'Validation check run' };
    // Step 1.
    for (const amountPaisa of [0, -33000, 10000100]) {
      const res = await send({ ...base, amountPaisa }).expect(400);
      expect({ amountPaisa, code: res.body.code, paths: res.body.details.fields.map((f: { path: string }) => f.path) }).toEqual({
        amountPaisa,
        code: 'VALIDATION_FAILED',
        paths: ['amountPaisa'],
      });
    }
    const paisa = await send({ ...base, amountPaisa: 33050 }).expect(400);
    expect(paisa.body).toMatchObject({ code: 'AMOUNT_NOT_WHOLE_RUPEES', message: 'Enter whole rupees, with no paisa.' });
    // Step 2.
    const fieldCases: Array<[Record<string, unknown>, string]> = [
      [{ ...base, note: 'too short' }, 'note'],
      [{ ...base, note: 'x'.repeat(301) }, 'note'],
      [{ direction: 'ADD', amountPaisa: 33000, reasonCode: 'OTHER' }, 'note'],
      [{ ...base, reasonCode: 'REFUND' }, 'reasonCode'],
      [{ ...base, direction: 'SET' }, 'direction'],
    ];
    for (const [body, field] of fieldCases) {
      const res = await send(body).expect(400);
      expect({ field, code: res.body.code, paths: res.body.details.fields.map((f: { path: string }) => f.path) }).toEqual({
        field,
        code: 'VALIDATION_FAILED',
        paths: [field],
      });
    }
    expect(await counts()).toEqual(before);
    // Step 3: the maximum is allowed.
    await send({ ...base, amountPaisa: 10000000, note: 'Upper limit check run' }).expect(201);
    expect(await balanceOf(std.DA.id)).toBe(10_500_000n);
  });

  it('WAL-012 corrections are never capped, and a related top-up or order must be the same distributor’s', async () => {
    let n = 50;
    const send = (body: Record<string, unknown>) => correct(std.DA.id, body, key('3', n++));
    // Step 4.
    await http().patch('/api/v1/settings/wallet.maxBalancePaisa').set(office()).send({ value: 1000000, reason: 'cap test for corrections' }).expect(200);
    const capped = await send({ direction: 'ADD', amountPaisa: 1000000, reasonCode: 'OTHER', note: 'Cap does not apply check' }).expect(201);
    expect(capped.body.wallet).toMatchObject({ balancePaisa: '1500000', capPaisa: '1000000' });
    await http().patch('/api/v1/settings/wallet.maxBalancePaisa').set(office()).send({ value: null, reason: 'cap back to none' }).expect(200);
    // Step 5.
    const before = await counts();
    const dbPayment = await seedTopup({ distributor: std.DB, amountPaisa: 50_000n });
    const otherPayment = await send({ direction: 'ADD', amountPaisa: 33000, reasonCode: 'OTHER', note: 'Related record check', relatedPaymentId: dbPayment.id }).expect(404);
    expect(otherPayment.body).toMatchObject({ code: 'NOT_FOUND', details: { field: 'relatedPaymentId' } });
    const unknownOrder = await send({ direction: 'ADD', amountPaisa: 33000, reasonCode: 'OTHER', note: 'Related record check', relatedOrderId: key('e', 7) }).expect(404);
    expect(unknownOrder.body).toMatchObject({ code: 'NOT_FOUND', details: { field: 'relatedOrderId' } });
    expect(await counts()).toEqual(before);
  });

  it('WAL-013 a retried correction is applied once; a different body or another wallet under the same key is refused', async () => {
    const K3 = key('5', 3);
    const body = { direction: 'ADD', amountPaisa: 33000, reasonCode: 'SYSTEM_ERROR', note: 'Retry check correction' };
    // Step 1.
    const first = await correct(std.DA.id, body, K3).expect(201);
    expect(first.body.wallet.balancePaisa).toBe('533000');
    // Step 2: a network retry.
    const retry = await correct(std.DA.id, body, K3).expect(200);
    expect(retry.headers['idempotent-replay']).toBe('true');
    expect(retry.body.entry.id).toBe(first.body.entry.id);
    expect(retry.body.wallet.balancePaisa).toBe('533000');
    // Step 3.
    const changed = await correct(std.DA.id, { ...body, amountPaisa: 50000 }, K3).expect(409);
    expect(changed.body).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', message: 'This was already sent with different details. Start again.' });
    // Step 4: no key at all.
    const keyless = await correct(std.DA.id, body).expect(400);
    expect(keyless.body.code).toBe('VALIDATION_FAILED');
    expect(keyless.body.details.fields).toEqual([expect.objectContaining({ path: 'Idempotency-Key', code: 'REQUIRED' })]);
    // Step 5: the key belongs to DA's correction.
    const elsewhere = await correct(std.DB.id, body, K3).expect(409);
    expect(elsewhere.body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await balanceOf(std.DB.id)).toBe(0n);
    // Step 6.
    expect(await db().ledgerEntry.count({ where: { idempotencyKey: `adjust:${K3}` } })).toBe(1);
    expect((await auditRows('wallet.correction')).length).toBe(1);
    expect(await balanceOf(std.DA.id)).toBe(533_000n);
  });

  it('WAL-013 two copies of one correction sent at the same moment apply it once: one 201, one replay', async () => {
    const body = { direction: 'TAKE', amountPaisa: 20000, reasonCode: 'SYSTEM_ERROR', note: 'Racing retry correction' };
    for (let round = 1; round <= 5; round++) {
      const K = key('6', round);
      const [a, b] = await Promise.all([correct(std.DA.id, body, K), correct(std.DA.id, body, K)]);
      expect({ round, statuses: [a.status, b.status].sort() }).toEqual({ round, statuses: [200, 201] });
      const replay = a.status === 200 ? a : b;
      expect(replay.headers['idempotent-replay']).toBe('true');
      expect(a.body.entry.id).toBe(b.body.entry.id);
      expect(await db().ledgerEntry.count({ where: { idempotencyKey: `adjust:${K}` } })).toBe(1);
    }
    expect(await balanceOf(std.DA.id)).toBe(400_000n);
    expect((await auditRows('wallet.correction')).length).toBe(5);
    await expectRunningBalances(std.DA.id);
  }, 180_000);

  it("WAL-014 two office users taking money at the same moment can't overdraw the wallet", async () => {
    const SA2 = authHeader(std.SA2.actor);
    for (let round = 1; round <= 20; round++) {
      const adjustBefore = await db().ledgerEntry.count({ where: { distributorId: std.DA.id, entryType: 'ADJUSTMENT' } });
      const [one, two] = await Promise.all([
        correct(std.DA.id, { direction: 'TAKE', amountPaisa: 300000, reasonCode: 'BANK_REVERSAL', note: 'Parallel take one' }, key('7', round * 2)),
        correct(std.DA.id, { direction: 'TAKE', amountPaisa: 300000, reasonCode: 'BANK_REVERSAL', note: 'Parallel take two' }, key('7', round * 2 + 1), SA2),
      ]);
      expect({ round, statuses: [one.status, two.status].sort() }).toEqual({ round, statuses: [201, 409] });
      const loser = one.status === 409 ? one : two;
      expect(loser.body).toMatchObject({ code: 'WALLET_ADJUST_EXCEEDS_BALANCE', details: { balancePaisa: '200000' } });
      expect(await balanceOf(std.DA.id)).toBe(200_000n);
      expect(await db().ledgerEntry.count({ where: { distributorId: std.DA.id, entryType: 'ADJUSTMENT' } })).toBe(adjustBefore + 1);
      expect(await walletMismatches()).toEqual([]);
      // Back to Rs 5,000 for the next round.
      await correct(std.DA.id, { direction: 'ADD', amountPaisa: 300000, reasonCode: 'OTHER', note: 'Reset for the next round' }, key('8', round)).expect(201);
    }
    await expectRunningBalances(std.DA.id);
  }, 180_000);

  it('WAL-017 an order and a correction racing for the last Rs 250: exactly one wins', async () => {
    await correct(std.DA.id, { direction: 'TAKE', amountPaisa: 475000, reasonCode: 'OTHER', note: 'Race test setup to Rs 250' }, key('9', 1)).expect(201);
    for (let round = 1; round <= 20; round++) {
      const [order, take] = await Promise.all([
        http().post('/api/v1/orders').set(authHeader(std.DA.actor)).set('Idempotency-Key', key('a', round)).send(x1OrderBody(std)),
        correct(std.DA.id, { direction: 'TAKE', amountPaisa: 25000, reasonCode: 'OTHER', note: 'Race test correction' }, key('b', round)),
      ]);
      const wins = [order.status === 201, take.status === 201].filter(Boolean).length;
      expect({ round, wins }).toEqual({ round, wins: 1 });
      if (order.status === 201) {
        expect(take.body).toMatchObject({ code: 'WALLET_ADJUST_EXCEEDS_BALANCE', details: { balancePaisa: '0' } });
      } else {
        expect(order.status).toBe(409);
        expect(order.body).toMatchObject({
          code: 'WALLET_INSUFFICIENT_BALANCE',
          details: { requiredPaisa: '25000', balancePaisa: '0', shortByPaisa: '25000' },
        });
        expect(await db().order.count({ where: { clientRequestId: key('a', round) } })).toBe(0);
      }
      expect(await balanceOf(std.DA.id)).toBe(0n);
      expect(await walletMismatches()).toEqual([]);
      await correct(std.DA.id, { direction: 'ADD', amountPaisa: 25000, reasonCode: 'OTHER', note: 'Race test reset to Rs 250' }, key('c', round)).expect(201);
    }
  }, 180_000);

  it('FEE-002 X4: the balance must cover the cost exactly; Rs 1 short is refused and nothing is created', async () => {
    const shop = authHeader(std.DA.actor);
    await correct(std.DA.id, { direction: 'TAKE', amountPaisa: 475000, reasonCode: 'OTHER', note: 'X4 setup exact' }, key('d', 1)).expect(201);
    // Step 1.
    const exact = await http().post('/api/v1/orders').set(shop).set('Idempotency-Key', key('d', 2)).send(x1OrderBody(std)).expect(201);
    expect(await balanceOf(std.DA.id)).toBe(0n);
    const debit = await db().ledgerEntry.findFirstOrThrow({ where: { orderId: exact.body.id, entryType: 'DEBIT_ORDER' } });
    expect(debit.balanceAfterPaisa).toBe(0n);
    // Step 2.
    await correct(std.DA.id, { direction: 'ADD', amountPaisa: 24900, reasonCode: 'OTHER', note: 'X4 setup one short' }, key('d', 3)).expect(201);
    const nextOrderNo = (await db().distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).nextOrderNo;
    const ordersBefore = await db().order.count();
    const ledgerBefore = await db().ledgerEntry.count();
    // Step 3.
    const short = await http().post('/api/v1/orders').set(shop).set('Idempotency-Key', key('d', 4)).send(x1OrderBody(std)).expect(409);
    expect(short.body).toMatchObject({
      code: 'WALLET_INSUFFICIENT_BALANCE',
      details: { requiredPaisa: '25000', balancePaisa: '24900', shortByPaisa: '100' },
      message: 'Not enough balance. This needs Rs 250 and you have Rs 249. Add money to continue.',
    });
    // Step 4.
    expect(await db().order.count()).toBe(ordersBefore);
    expect(await db().ledgerEntry.count()).toBe(ledgerBefore);
    expect((await db().distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).nextOrderNo).toBe(nextOrderNo);
    expect(await balanceOf(std.DA.id)).toBe(24_900n);
  });
});
