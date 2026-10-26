/**
 * The office's side of manual top-ups (API_CONTRACT §7.9, §8.2): the queue, approval against the bank
 * (credited once, a bank reference used once ever, the amount-mismatch setting, the cap), rejection,
 * and races between office users. TOP-013, TOP-015 to TOP-021, and the money sides of FEE-004 and FEE-024.
 */
import type { INestApplication } from '@nestjs/common';
import { userActor } from '../../src/common/auth/actor';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { currentBusinessDay } from '../../src/modules/wallet/business-day';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb, walletMismatches } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http as client } from '../helpers/http';
import { createStandardData, x1OrderBody, type StandardData } from '../helpers/standard-data';
import { auditRows, balanceOf, expectRunningBalances, insertOrder, key, minutesAgo, seedTopup, setCompanyAccount } from './money-fixtures';

describeDb('money: top-up review by the office', () => {
  let app: INestApplication;
  let std: StandardData;
  const db = () => getTestPrisma();
  const http = () => client(app);
  let n = 0;
  const nextKey = () => key('b', ++n);

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
  const office2 = () => authHeader(std.SA2.actor);

  function approve(paymentId: string, body: Record<string, unknown>, who = office(), idempotencyKey: string = nextKey()) {
    return http().post(`/api/v1/payments/${paymentId}/approve`).set(who).set('Idempotency-Key', idempotencyKey).send(body);
  }

  function reject(paymentId: string, body: Record<string, unknown>, who = office()) {
    return http().post(`/api/v1/payments/${paymentId}/reject`).set(who).send(body);
  }

  const bank = (bankReference: unknown, bankAmountPaisa: unknown = 500000, bankTime: unknown = minutesAgo(20)) => ({
    bankReference,
    bankAmountPaisa,
    bankTime,
  });

  async function pending(distributor = std.DA, amountPaisa = 500_000n) {
    return seedTopup({ distributor, amountPaisa });
  }

  async function statusOf(paymentId: string) {
    return (await db().payment.findUniqueOrThrow({ where: { id: paymentId } })).status;
  }

  it('TOP-013 the office queue: tabs, counts, order, search and today’s total', async () => {
    const today = await currentBusinessDay(app.get(SettingsService));
    const t = (minutes: number) => new Date(today.start.getTime() + minutes * 60_000);
    const approvedAt = new Date(Math.max(Date.now() - 60_000, today.start.getTime() + 1_000));
    const before = new Date(today.start.getTime() - 24 * 3600_000);
    // AG-T001 approved today (FT-1111); AG-T002/T003 and BG-T001 waiting; BG-T002 rejected.
    const approved = await seedTopup({
      distributor: std.DA,
      amountPaisa: 500_000n,
      payerName: 'Ahmed Gas',
      status: 'SUCCESS',
      bankReference: 'FT-1111',
      bankAmountPaisa: 500_000n,
      createdAt: before,
      completedAt: approvedAt,
      verifiedByUserId: std.SA1.id,
    });
    const waitingA = await seedTopup({ distributor: std.DA, amountPaisa: 200_000n, payerName: 'Ahmed Gas', createdAt: t(-180) });
    const waitingB = await seedTopup({ distributor: std.DB, amountPaisa: 100_000n, payerName: 'Bilal Khan', createdAt: t(-165) });
    const waitingC = await seedTopup({
      distributor: std.DA,
      amountPaisa: 300_000n,
      payerName: 'Ahmed Raza',
      transactionId: 'EP-5566',
      createdAt: t(-150),
    });
    const rejected = await seedTopup({
      distributor: std.DB,
      amountPaisa: 50_000n,
      payerName: 'Bilal Khan',
      status: 'REJECTED',
      createdAt: new Date(before.getTime() + 60_000),
      completedAt: before,
    });
    const list = (query: Record<string, unknown>) => http().get('/api/v1/admin/topups').query(query).set(office()).expect(200);
    const ids = (res: { body: { items: Array<{ id: string }> } }) => res.body.items.map((item) => item.id);

    // Step 1.
    const toCheck = await list({ tab: 'to-check' });
    expect(ids(toCheck)).toEqual([waitingA.id, waitingB.id, waitingC.id]);
    expect(toCheck.body.counts).toEqual({ toCheck: 3, approved: 1, rejected: 1 });
    expect(toCheck.body.approvedToday).toEqual({ count: 1, totalPaisa: '500000' });
    for (const item of toCheck.body.items) {
      expect(item.distributor).toEqual(expect.objectContaining({ businessName: expect.any(String), code: expect.any(String) }));
      expect(item.allowedActions).toEqual(['APPROVE', 'REJECT']);
    }
    expect(toCheck.body.nextCursor).toBeNull();
    // Step 2.
    const approvedTab = await list({ tab: 'approved' });
    expect(ids(approvedTab)).toEqual([approved.id]);
    expect(approvedTab.body.items[0]).toMatchObject({ bankReference: 'FT-1111', creditedPaisa: '500000', allowedActions: [], reviewedBy: { name: 'Owner' } });
    expect(ids(await list({ tab: 'rejected' }))).toEqual([rejected.id]);
    const all = await list({ tab: 'all' });
    expect(ids(all)).toEqual([waitingC.id, waitingB.id, waitingA.id, rejected.id, approved.id]);
    for (const item of all.body.items.filter((i: { status: string }) => i.status !== 'PENDING')) expect(item.allowedActions).toEqual([]);
    // Paging keeps the order.
    const page1 = await list({ tab: 'all', limit: 2 });
    const page2 = await list({ tab: 'all', limit: 2, cursor: page1.body.nextCursor });
    const page3 = await list({ tab: 'all', limit: 2, cursor: page2.body.nextCursor });
    expect([...ids(page1), ...ids(page2), ...ids(page3)]).toEqual(ids(all));
    expect(page3.body.nextCursor).toBeNull();
    // Step 3.
    const search = async (q: string) => ids(await list({ tab: 'all', q })).sort();
    expect(await search('Raza')).toEqual([waitingC.id]);
    expect(await search('EP-5566')).toEqual([waitingC.id]);
    expect(await search('FT-1111')).toEqual([approved.id]);
    expect(await search('Bilal')).toEqual([waitingB.id, rejected.id].sort());
    expect(await search('ft 1111')).toEqual([approved.id]);
    expect(await search('ag-t001')).toEqual([approved.id]);
    expect(approved.shortCode).toBe('AG-T001');
    // Bad input.
    await http().get('/api/v1/admin/topups').query({ tab: 'later' }).set(office()).expect(400);
    await http().get('/api/v1/admin/topups').query({ q: 'x'.repeat(101) }).set(office()).expect(400);
  }, 180_000);

  it('TOP-015 approving a top-up against the bank credits the wallet once, in one transaction', async () => {
    const request = await http()
      .post('/api/v1/payments/topup-requests')
      .set(shop())
      .set('Idempotency-Key', nextKey())
      .send({ amountPaisa: 500000, payerName: 'Ahmed Raza', payerChannel: 'BANK_APP' })
      .expect(201);
    const bankTime = minutesAgo(30);
    // Step 1.
    const res = await approve(request.body.id, bank('FT-7781-4402', 500000, bankTime)).expect(200);
    expect(res.headers['x-already-applied']).toBeUndefined();
    expect(res.body).toMatchObject({
      payment: {
        status: 'SUCCESS',
        stage: 'ADDED',
        creditedPaisa: '500000',
        bankReference: 'FT-7781-4402',
        bankAmountPaisa: '500000',
        bankReceivedAt: new Date(bankTime).toISOString(),
        reviewedBy: { id: std.SA1.id, name: 'Owner' },
        allowedActions: [],
      },
      wallet: { balancePaisa: '1000000', pendingTopupPaisa: '0' },
      amountDiffered: false,
    });
    // Step 2.
    expect((await http().get('/api/v1/wallet').set(shop()).expect(200)).body.balancePaisa).toBe('1000000');
    const statement = await http().get('/api/v1/wallet/statement').set(shop()).expect(200);
    expect(statement.body.items[0]).toMatchObject({
      kind: 'TOPUP_ADDED',
      amountPaisa: '500000',
      subject: { type: 'TOPUP', id: request.body.id, shortCode: request.body.shortCode },
    });
    // Step 3.
    const row = await db().payment.findUniqueOrThrow({ where: { id: request.body.id } });
    expect(row).toMatchObject({ bankReferenceKey: 'FT77814402', verifiedByUserId: std.SA1.id, bankAmountPaisa: 500_000n });
    expect(row.bankReceivedAt?.toISOString()).toBe(new Date(bankTime).toISOString());
    expect(row.completedAt).not.toBeNull();
    const credits = await db().ledgerEntry.findMany({ where: { paymentId: request.body.id } });
    expect(credits.map((c) => [c.entryType, c.amountPaisa, c.idempotencyKey, c.balanceAfterPaisa])).toEqual([
      ['CREDIT_TOPUP', 500_000n, `topup:${request.body.id}`, 1_000_000n],
    ]);
    const audits = await auditRows('topup.approve');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: std.SA1.id, distributorId: std.DA.id, resourceType: 'Payment', resourceId: request.body.id });
  });

  it('TOP-016 approval needs a valid bank reference, a bank time not in the future and a valid bank amount', async () => {
    const P = await pending();
    const refusedNothing = async () => {
      expect(await statusOf(P.id)).toBe('PENDING');
      expect(await db().ledgerEntry.count({ where: { paymentId: P.id } })).toBe(0);
      expect((await auditRows('topup.approve')).length).toBe(0);
    };
    // Step 1.
    for (const reference of ['', 'ab', '-- --', 'A'.repeat(41)]) {
      const res = await approve(P.id, bank(reference)).expect(400);
      expect({ reference, code: res.body.code, message: res.body.message }).toEqual({
        reference,
        code: 'TOPUP_BANK_REFERENCE_REQUIRED',
        message: 'Type the bank reference from the company bank app.',
      });
    }
    await refusedNothing();
    // Step 3.
    const future = await approve(P.id, bank('FT-1616-0001', 500000, new Date(Date.now() + 10 * 60_000).toISOString())).expect(400);
    expect(future.body).toMatchObject({ code: 'TOPUP_BANK_TIME_IN_FUTURE', message: "The bank time can't be in the future." });
    const noTime = await approve(P.id, { bankReference: 'FT-1616-0001', bankAmountPaisa: 500000 }).expect(400);
    expect(noTime.body.code).toBe('VALIDATION_FAILED');
    // Step 4.
    const noAmount = await approve(P.id, { bankReference: 'FT-1616-0001', bankTime: minutesAgo(1) }).expect(400);
    expect(noAmount.body.code).toBe('VALIDATION_FAILED');
    expect((await approve(P.id, bank('FT-1616-0001', 450050)).expect(400)).body.code).toBe('AMOUNT_NOT_WHOLE_RUPEES');
    expect((await approve(P.id, bank('FT-1616-0001', 40000)).expect(400)).body.code).toBe('TOPUP_AMOUNT_TOO_SMALL');
    expect((await approve(P.id, bank('FT-1616-0001', 6000000)).expect(400)).body.code).toBe('TOPUP_AMOUNT_TOO_LARGE');
    await refusedNothing();
    // Step 3: two minutes ahead is allowed for clock differences.
    await approve(P.id, bank('FT-1616-0001', 500000, new Date(Date.now() + 2 * 60_000).toISOString())).expect(200);
    // Step 2.
    const spaced = await pending();
    const short = await pending();
    const long = await pending();
    const first = await approve(spaced.id, bank(' ft-7781 4402 ')).expect(200);
    expect(first.body.payment.bankReference).toBe('ft-7781 4402');
    expect((await db().payment.findUniqueOrThrow({ where: { id: spaced.id } })).bankReferenceKey).toBe('FT77814402');
    await approve(short.id, bank('A1B')).expect(200);
    await approve(long.id, bank('B'.repeat(40))).expect(200);
    expect(await walletMismatches()).toEqual([]);
  }, 180_000);

  it('TOP-017 a bank reference can be used once ever, whatever its spacing or case, across distributors', async () => {
    const [P1, P2] = [await pending(), await pending()];
    const P3 = await pending(std.DB, 100_000n);
    const [P4, P5] = [await pending(), await pending()];
    // Step 1.
    const first = await approve(P1.id, bank('FT-7781-4402')).expect(200);
    // Step 2.
    const reused = await approve(P2.id, bank('ft 7781 4402')).expect(409);
    expect(reused.body).toMatchObject({
      code: 'TOPUP_BANK_REFERENCE_USED',
      details: { paymentShortCode: P1.shortCode, distributorName: 'Ahmed Gas', approvedAt: first.body.payment.reviewedAt },
      message: `Already used for ${P1.shortCode} (Ahmed Gas). Check it, or reject as a duplicate.`,
    });
    expect(await statusOf(P2.id)).toBe('PENDING');
    // Step 3.
    const otherShop = await approve(P3.id, bank('FT77814402', 100000)).expect(409);
    expect(otherShop.body).toMatchObject({ code: 'TOPUP_BANK_REFERENCE_USED', details: { paymentShortCode: P1.shortCode, distributorName: 'Ahmed Gas' } });
    expect(await balanceOf(std.DB.id)).toBe(0n);
    // Step 4.
    const [a, b] = await Promise.all([approve(P4.id, bank('IBFT-2210-5566')), approve(P5.id, bank('IBFT-2210-5566'), office2())]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.code).toBe('TOPUP_BANK_REFERENCE_USED');
    expect(await db().ledgerEntry.count({ where: { paymentId: { in: [P4.id, P5.id] } } })).toBe(1);
    expect(await walletMismatches()).toEqual([]);
  });

  it('TOP-017 two shops racing for one reference: exactly one is credited', async () => {
    for (let round = 1; round <= 10; round++) {
      const mine = await pending(std.DA, 100_000n);
      const theirs = await pending(std.DB, 100_000n);
      const reference = `RACE-${round}-${Date.now()}`;
      const [a, b] = await Promise.all([approve(mine.id, bank(reference, 100000)), approve(theirs.id, bank(reference, 100000), office2())]);
      expect({ round, statuses: [a.status, b.status].sort() }).toEqual({ round, statuses: [200, 409] });
      expect((a.status === 409 ? a : b).body.code).toBe('TOPUP_BANK_REFERENCE_USED');
      expect(await db().ledgerEntry.count({ where: { paymentId: { in: [mine.id, theirs.id] } } })).toBe(1);
    }
    expect(await walletMismatches()).toEqual([]);
  }, 180_000);

  it('TOP-018 a bank amount different from the request follows topup.onAmountMismatch', async () => {
    const [P1, P2, P3, P4] = [await pending(), await pending(), await pending(), await pending()];
    // Step 1.
    const less = await approve(P1.id, bank('FT-1801-0001', 450000)).expect(200);
    expect(less.body).toMatchObject({ amountDiffered: true, payment: { amountPaisa: '500000', creditedPaisa: '450000', bankAmountPaisa: '450000' } });
    expect(await balanceOf(std.DA.id)).toBe(950_000n);
    expect((await db().ledgerEntry.findMany({ where: { paymentId: P1.id } })).map((r) => r.amountPaisa)).toEqual([450_000n]);
    // Step 2.
    const more = await approve(P2.id, bank('FT-1801-0002', 550000)).expect(200);
    expect(more.body).toMatchObject({ amountDiffered: true, payment: { creditedPaisa: '550000' } });
    expect(await balanceOf(std.DA.id)).toBe(1_500_000n);
    // Step 3.
    await http().patch('/api/v1/settings/topup.onAmountMismatch').set(office()).send({ value: 'REJECT', reason: 'mismatch test' }).expect(200);
    const refused = await approve(P3.id, bank('FT-1801-0003', 450000)).expect(409);
    expect(refused.body).toMatchObject({
      code: 'TOPUP_AMOUNT_MISMATCH',
      message: 'Amounts must match. Reject and ask for a new request.',
    });
    expect(await statusOf(P3.id)).toBe('PENDING');
    expect(await db().ledgerEntry.count({ where: { paymentId: P3.id } })).toBe(0);
    const equal = await approve(P3.id, bank('FT-1801-0003', 500000)).expect(200);
    expect(equal.body.amountDiffered).toBe(false);
    // Step 4.
    await approve(P4.id, bank('FT-1801-0004', 450000)).expect(409);
    expect(await statusOf(P4.id)).toBe('PENDING');
    await http().patch('/api/v1/settings/topup.onAmountMismatch').set(office()).send({ value: 'CREDIT_BANK_AMOUNT', reason: 'mismatch test done' }).expect(200);
    // Step 5.
    expect((await auditRows('setting.update')).some((row) => row.reason === 'mismatch test')).toBe(true);
    expect((await auditRows('topup.approve')).length).toBe(3);
    expect(await walletMismatches()).toEqual([]);
  });

  it('TOP-019 a second approval of the same top-up is refused and never credits again', async () => {
    const P = await pending();
    const K = nextKey();
    // Step 1.
    const first = await approve(P.id, bank('FT-9001'), office(), K).expect(200);
    expect(first.body.wallet.balancePaisa).toBe('1000000');
    // Step 2: a network retry answers with the original result and credits nothing.
    const retry = await approve(P.id, bank('FT-9001'), office(), K).expect(200);
    expect(retry.headers['x-already-applied']).toBe('true');
    expect(retry.body.payment).toMatchObject({ id: P.id, status: 'SUCCESS', bankReference: 'FT-9001' });
    // Step 3.
    const again = await approve(P.id, bank('FT-9001')).expect(200);
    expect(again.headers['x-already-applied']).toBe('true');
    // Step 4.
    const other = await approve(P.id, bank('FT-9002')).expect(409);
    expect(other.body).toMatchObject({
      code: 'TOPUP_NOT_PENDING',
      message: 'This request was already handled.',
      details: { status: 'SUCCESS', reviewedBy: { id: std.SA1.id, name: 'Owner' }, reviewedAt: first.body.payment.reviewedAt },
    });
    // Step 5.
    const rejected = await reject(P.id, { reasonCode: 'NOT_IN_BANK' }).expect(409);
    expect(rejected.body.code).toBe('TOPUP_NOT_PENDING');
    expect(await statusOf(P.id)).toBe('SUCCESS');
    // Step 6.
    expect(await db().ledgerEntry.count({ where: { paymentId: P.id } })).toBe(1);
    expect(await balanceOf(std.DA.id)).toBe(1_000_000n);
    expect((await auditRows('topup.approve')).length).toBe(1);
  });

  it('TOP-020 two office users acting on one top-up at the same moment: only one wins', async () => {
    // Round A: the same reference.
    for (let round = 1; round <= 20; round++) {
      const P = await pending();
      const [a, b] = await Promise.all([approve(P.id, bank(`FTA-${round}`)), approve(P.id, bank(`FTA-${round}`), office2())]);
      expect({ round, statuses: [a.status, b.status] }).toEqual({ round, statuses: [200, 200] });
      expect([a.headers['x-already-applied'], b.headers['x-already-applied']].filter(Boolean)).toEqual(['true']);
      expect(await db().ledgerEntry.count({ where: { paymentId: P.id } })).toBe(1);
    }
    expect(await balanceOf(std.DA.id)).toBe(500_000n + 20n * 500_000n);
    // Round B: different references.
    for (let round = 1; round <= 20; round++) {
      const P = await pending();
      const [a, b] = await Promise.all([approve(P.id, bank(`FTB-${round}-1`)), approve(P.id, bank(`FTB-${round}-2`), office2())]);
      expect({ round, statuses: [a.status, b.status].sort() }).toEqual({ round, statuses: [200, 409] });
      const [winner, loser] = a.status === 200 ? [a, b] : [b, a];
      expect(loser.body).toMatchObject({ code: 'TOPUP_NOT_PENDING', details: { status: 'SUCCESS' } });
      expect((await db().payment.findUniqueOrThrow({ where: { id: P.id } })).bankReference).toBe(winner.body.payment.bankReference);
      expect(await db().ledgerEntry.count({ where: { paymentId: P.id } })).toBe(1);
    }
    // Round C: approve against reject.
    for (let round = 1; round <= 20; round++) {
      const P = await pending();
      const [a, r] = await Promise.all([approve(P.id, bank(`FTC-${round}`)), reject(P.id, { reasonCode: 'NOT_IN_BANK' }, office2())]);
      expect({ round, statuses: [a.status, r.status].sort() }).toEqual({ round, statuses: [200, 409] });
      if (a.status === 200) {
        expect(r.body.code).toBe('TOPUP_NOT_PENDING');
        expect(await db().ledgerEntry.count({ where: { paymentId: P.id } })).toBe(1);
      } else {
        expect(a.body).toMatchObject({ code: 'TOPUP_NOT_PENDING', details: { status: 'REJECTED' } });
        expect(await db().ledgerEntry.count({ where: { paymentId: P.id } })).toBe(0);
      }
    }
    expect(await walletMismatches()).toEqual([]);
    await expectRunningBalances(std.DA.id);
  }, 180_000);

  it('TOP-021 rejecting a top-up needs a reason code, moves no money and is audited', async () => {
    const [P1, P2] = [await pending(), await pending()];
    const P3 = await pending();
    await approve(P3.id, bank('FT-2103-0001')).expect(200);
    const balance = await balanceOf(std.DA.id);
    // Step 1.
    for (const body of [{ reasonCode: 'FRAUD' }, { reasonCode: 'OTHER' }, { reasonCode: 'OTHER', note: 'ab' }]) {
      expect((await reject(P1.id, body).expect(400)).body.code).toBe('VALIDATION_FAILED');
    }
    // Step 2.
    const done = await reject(P1.id, { reasonCode: 'NOT_IN_BANK' }).expect(200);
    expect(done.body.payment).toMatchObject({ status: 'REJECTED', stage: 'NOT_ADDED', rejectReasonCode: 'NOT_IN_BANK', rejectNote: null, allowedActions: [] });
    const repeat = await reject(P1.id, { reasonCode: 'AMOUNT_DIFFERENT' }).expect(200);
    expect(repeat.headers['x-already-applied']).toBe('true');
    expect(repeat.body.payment.rejectReasonCode).toBe('NOT_IN_BANK');
    // Step 3.
    const withNote = await reject(P2.id, { reasonCode: 'OTHER', note: 'Payer name and amount both differ' }).expect(200);
    expect(withNote.body.payment).toMatchObject({ rejectReasonCode: 'OTHER', rejectNote: 'Payer name and amount both differ' });
    // Step 4.
    expect((await reject(P3.id, { reasonCode: 'NOT_IN_BANK' }).expect(409)).body.code).toBe('TOPUP_NOT_PENDING');
    expect(await statusOf(P3.id)).toBe('SUCCESS');
    // Step 5.
    const seen = await http().get(`/api/v1/payments/${P2.id}`).set(shop()).expect(200);
    expect(seen.body).toMatchObject({ stage: 'NOT_ADDED', rejectReasonCode: 'OTHER', rejectNote: 'Payer name and amount both differ' });
    expect((await http().get(`/api/v1/payments/${P1.id}`).set(shop()).expect(200)).body.rejectReasonCode).toBe('NOT_IN_BANK');
    expect(await balanceOf(std.DA.id)).toBe(balance);
    expect(await db().ledgerEntry.count({ where: { paymentId: { in: [P1.id, P2.id] } } })).toBe(0);
    const audits = await auditRows('topup.reject');
    expect(audits.map((row) => row.resourceId).sort()).toEqual([P1.id, P2.id].sort());
    for (const row of audits) expect(row.reason).toBeTruthy();
  });

  it("FEE-004 office money actions don't depend on the distributor's status; the shop's own top-up request does", async () => {
    // Step 1.
    const R = await http()
      .post('/api/v1/payments/topup-requests')
      .set(shop())
      .set('Idempotency-Key', nextKey())
      .send({ amountPaisa: 200000, payerName: 'Ahmed Raza', payerChannel: 'BANK_APP' })
      .expect(201);
    // Step 2.
    await db().distributor.update({ where: { id: std.DA.id }, data: { status: 'SUSPENDED' } });
    const paymentsBefore = await db().payment.count();
    // Step 3.
    const refused = await http()
      .post('/api/v1/payments/topup-requests')
      .set(shop())
      .set('Idempotency-Key', nextKey())
      .send({ amountPaisa: 100000, payerName: 'Ahmed Raza', payerChannel: 'BANK_APP' })
      .expect(403);
    expect(refused.body).toMatchObject({ code: 'DISTRIBUTOR_NOT_ACTIVE', message: "This shop account isn't active. Call the office." });
    const legacy = await http().post('/api/v1/payments/topup').set(shop()).send({ amountPaisa: 100000, provider: 'BANK_MANUAL' }).expect(403);
    expect(legacy.body.code).toBe('DISTRIBUTOR_NOT_ACTIVE');
    expect(await db().payment.count()).toBe(paymentsBefore);
    // Step 4.
    await approve(R.body.id, bank('FT-0404-0001', 200000)).expect(200);
    await http()
      .post(`/api/v1/admin/distributors/${std.DA.id}/wallet/corrections`)
      .set(office())
      .set('Idempotency-Key', nextKey())
      .send({ direction: 'ADD', amountPaisa: 10000, reasonCode: 'OTHER', note: 'Suspended shop correction check' })
      .expect(201);
    // Step 5.
    await db().distributor.update({ where: { id: std.DA.id }, data: { status: 'ACTIVE' } });
    expect(await db().ledgerEntry.count({ where: { distributorId: std.DA.id, entryType: 'DEBIT_ORDER' } })).toBe(0);
    expect(await balanceOf(std.DA.id)).toBe(710_000n);
    expect(await walletMismatches()).toEqual([]);
  });

  it('FEE-004 a suspended distributor can’t place an order, and nothing is deducted', async () => {
    await db().distributor.update({ where: { id: std.DA.id }, data: { status: 'SUSPENDED' } });
    const res = await http().post('/api/v1/orders').set(shop()).set('Idempotency-Key', nextKey()).send(x1OrderBody(std)).expect(403);
    expect(res.body.code).toBe('DISTRIBUTOR_NOT_ACTIVE');
    expect(await db().order.count()).toBe(0);
    expect(await balanceOf(std.DA.id)).toBe(500_000n);
  });

  it('FEE-024 approvedToday counts approvals by the business day of the approval (G14-02)', async () => {
    const today = await currentBusinessDay(app.get(SettingsService));
    const span = Date.now() - today.start.getTime();
    const at = (fraction: number) => new Date(today.start.getTime() + Math.floor(span * fraction));
    const approvedAt = (amountPaisa: bigint, completedAt: Date, reference: string) =>
      seedTopup({ distributor: std.DA, amountPaisa, status: 'SUCCESS', bankReference: reference, bankAmountPaisa: amountPaisa, completedAt, verifiedByUserId: std.SA1.id });
    await approvedAt(500_000n, at(1 / 3), 'FT-2401-0001');
    await approvedAt(200_000n, at(2 / 3), 'FT-2401-0002');
    // 02:30 on the calendar day of the business day's start still belongs to the day before.
    await approvedAt(100_000n, new Date(today.start.getTime() - 30 * 60_000), 'FT-2401-0003');
    const res = await http().get('/api/v1/admin/topups?tab=to-check').set(office()).expect(200);
    expect(res.body.approvedToday).toEqual({ count: 2, totalPaisa: '700000' });
  });

  it('FEE-024 delivery costs taken today are the costs deducted minus the costs returned, by business day', async () => {
    const today = await currentBusinessDay(app.get(SettingsService));
    const wallet = app.get(WalletService);
    const actor = userActor(std.DA.actor);
    const debit = async (amountPaisa: bigint, client = std.C1) => {
      const order = await insertOrder({ distributor: std.DA, client, zoneId: std.zones.North.id });
      await db().$transaction((tx) => wallet.debit(tx, { distributorId: std.DA.id, subject: { type: 'ORDER', orderId: order.id }, amountPaisa, actor }));
      return order.id;
    };
    const x1 = await debit(25_000n);
    await debit(40_000n, std.C2);
    await db().$transaction((tx) => wallet.reverse(tx, { subject: { type: 'ORDER', orderId: x1 }, actor, reason: 'Cancelled' }));
    // A Rs 400 debit at 02:30, before today's cut-off: yesterday's business day.
    const early = await debit(40_000n, std.C2);
    await db().ledgerEntry.updateMany({ where: { orderId: early }, data: { createdAt: new Date(today.start.getTime() - 30 * 60_000) } });
    expect(await wallet.deliveryCostTaken(today)).toBe(40_000n);
  });

  it('FEE-024 GET /admin/summary shows today’s delivery costs taken and approvals, by business day', async () => {
    const res = await http().get('/api/v1/admin/summary').set(office()).expect(200);
    const topups = await http().get('/api/v1/admin/topups?tab=to-check').set(office()).expect(200);
    expect(res.body.topups.approvedToday).toEqual(topups.body.approvedToday);
    expect(res.body.orders.costTakenTodayPaisa).toBe('0');
  });
});
