/**
 * The shop's side of manual top-ups (API_CONTRACT §7.9): top-up info, "tell us you paid" requests with
 * their rules in a fixed order, idempotent retries and who may see what. TOP-001 to TOP-008 and TOP-028.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http as client } from '../helpers/http';
import { createStandardData, DUMMY_COMPANY_ACCOUNT, type StandardData } from '../helpers/standard-data';
import { auditRows, key, minutesAgo, setCompanyAccount } from './money-fixtures';

describeDb('money: top-up requests', () => {
  let app: INestApplication;
  let std: StandardData;
  const db = () => getTestPrisma();
  const http = () => client(app);
  let n = 0;
  const nextKey = () => key('a', ++n);

  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
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

  function request(body: Record<string, unknown>, who = shop(), idempotencyKey: string | null = nextKey()) {
    const req = http().post('/api/v1/payments/topup-requests').set(who);
    return (idempotencyKey ? req.set('Idempotency-Key', idempotencyKey) : req).send(body);
  }

  const tellUs = (amountPaisa: unknown, extra: Record<string, unknown> = {}) => ({
    amountPaisa,
    payerName: 'Ahmed Raza',
    payerChannel: 'BANK_APP',
    ...extra,
  });

  function patchSetting(k: string, value: unknown, reason: string) {
    return http().patch(`/api/v1/settings/${k}`).set(office()).send({ value, reason });
  }

  /** A picture the user uploaded, as FilesService.upload stores it (no object storage needed here). */
  async function uploadedPicture(userId: string, distributorId: string | null = null): Promise<string> {
    const file = await db().storedFile.create({
      data: {
        storageKey: `uploads/2026-10-22/${randomUUID()}.jpg`,
        purpose: 'TOPUP_PROOF',
        mimeType: 'image/jpeg',
        sizeBytes: 2048,
        sha256: randomUUID().replace(/-/g, '').padEnd(64, '0'),
        uploadedByUserId: userId,
        distributorId,
      },
    });
    return file.id;
  }

  it('TOP-001 top-up info comes from settings, and top-ups are closed while no company account is set', async () => {
    // Step 1.
    const info = await http().get('/api/v1/payments/topup-info').set(shop()).expect(200);
    expect(info.body).toEqual({
      account: { ...DUMMY_COMPANY_ACCOUNT },
      limits: { minPaisa: '50000', maxPaisa: '5000000', maxNowPaisa: null },
      quickAmountsPaisa: ['200000', '500000', '1000000'],
      payerChannels: ['EASYPAISA_APP', 'BANK_APP', 'OTHER'],
      checkingHours: { from: '09:00', to: '21:00' },
      support: { phone: null, hours: '9am–9pm' },
      pending: { count: 0, totalPaisa: '0' },
      training: false,
    });
    // Step 2.
    expect((await http().get('/api/v1/payments/topup-info').set(office()).expect(403)).body.code).toBe('PERMISSION_DENIED');
    // Step 3.
    await setCompanyAccount(app, null);
    const closed = [
      await http().get('/api/v1/payments/topup-info').set(shop()),
      await request(tellUs(500000)),
      await http().post('/api/v1/payments/topup').set(shop()).send({ amountPaisa: 500000, provider: 'BANK_MANUAL' }),
    ];
    for (const res of closed) {
      expect({ status: res.status, code: res.body.code, message: res.body.message }).toEqual({
        status: 503,
        code: 'TOPUP_ACCOUNT_NOT_CONFIGURED',
        message: "Top-ups aren't open yet. Call the office.",
      });
    }
    expect(await db().payment.count()).toBe(0);
  });

  it('TOP-002 telling the app you paid creates one request being checked, with no money moved', async () => {
    const fileId = await uploadedPicture(std.DA.userId, std.DA.id);
    const ledgerBefore = await db().ledgerEntry.count();
    // Step 1.
    const created = await request(tellUs(500000, { payerChannel: 'EASYPAISA_APP', transactionId: 'EP-123456789', proofFileId: fileId })).expect(201);
    expect(created.body).toMatchObject({
      shortCode: 'AG-T001',
      requestNo: 1,
      status: 'PENDING',
      stage: 'BEING_CHECKED',
      amountPaisa: '500000',
      creditedPaisa: null,
      payerName: 'Ahmed Raza',
      payerChannel: 'EASYPAISA_APP',
      transactionId: 'EP-123456789',
      reviewedAt: null,
      rejectReasonCode: null,
      allowedActions: [],
    });
    expect(created.body.proofUrl).toEqual(expect.stringContaining('X-Amz-Signature'));
    for (const officeOnly of ['distributor', 'bankReference', 'bankAmountPaisa', 'bankReceivedAt', 'reviewedBy']) {
      expect(created.body).not.toHaveProperty(officeOnly);
    }
    // Step 2.
    const mine = await http().get('/api/v1/payments/mine').set(shop()).expect(200);
    expect(Array.isArray(mine.body)).toBe(true);
    expect(mine.body[0].id).toBe(created.body.id);
    expect((await http().get('/api/v1/wallet').set(shop()).expect(200)).body).toMatchObject({
      balancePaisa: '500000',
      pendingTopupPaisa: '500000',
      pendingTopupCount: 1,
    });
    // Step 3.
    const row = await db().payment.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row).toMatchObject({ provider: 'BANK_MANUAL', providerTxnId: null, requestNo: 1, proofFileId: fileId, status: 'PENDING' });
    expect(await db().ledgerEntry.count()).toBe(ledgerBefore);
    const audits = await auditRows('topup.request');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: std.DA.userId, resourceType: 'Payment', resourceId: created.body.id, distributorId: std.DA.id });
    expect((await db().distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).nextTopupNo).toBe(2);
  });

  it('TOP-003 the top-up amount must be whole rupees within the limits set in settings', async () => {
    const before = await db().payment.count();
    // Step 1.
    const small = await request(tellUs(49900)).expect(400);
    expect(small.body).toMatchObject({
      code: 'TOPUP_AMOUNT_TOO_SMALL',
      message: 'The minimum top-up is Rs 500.',
      details: { minPaisa: '50000', maxPaisa: '5000000' },
    });
    await request(tellUs(50000)).expect(201);
    await request(tellUs(5000000)).expect(201);
    const large = await request(tellUs(5000100)).expect(400);
    expect(large.body).toMatchObject({ code: 'TOPUP_AMOUNT_TOO_LARGE', message: 'The maximum top-up is Rs 50,000.' });
    const paisa = await request(tellUs(50050)).expect(400);
    expect(paisa.body.code).toBe('AMOUNT_NOT_WHOLE_RUPEES');
    expect(await db().payment.count()).toBe(before + 2);
    // Step 2.
    await patchSetting('topup.minPaisa', 100000, 'raise minimum test').expect(200);
    await patchSetting('topup.maxPaisa', 2000000, 'lower maximum test').expect(200);
    // Step 3.
    const newMin = await request(tellUs(50000)).expect(400);
    expect(newMin.body).toMatchObject({ code: 'TOPUP_AMOUNT_TOO_SMALL', message: 'The minimum top-up is Rs 1,000.' });
    const newMax = await request(tellUs(2500000)).expect(400);
    expect(newMax.body).toMatchObject({ code: 'TOPUP_AMOUNT_TOO_LARGE', message: 'The maximum top-up is Rs 20,000.' });
    const info = await http().get('/api/v1/payments/topup-info').set(shop()).expect(200);
    expect(info.body.limits).toMatchObject({ minPaisa: '100000', maxPaisa: '2000000' });
    const updates = await auditRows('setting.update');
    expect(updates.filter((row) => row.actorUserId === std.SA1.id).map((row) => row.reason)).toEqual(['raise minimum test', 'lower maximum test']);
    expect(await db().payment.count()).toBe(before + 2);
    await patchSetting('topup.minPaisa', 50000, 'restore the minimum').expect(200);
    await patchSetting('topup.maxPaisa', 5000000, 'restore the maximum').expect(200);
  });

  it('TOP-004 request details are validated: payer name, channel, transaction ID and screenshot ownership', async () => {
    // Step 1.
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ payerName: 'A' }, 'payerName'],
      [{ payerName: 'x'.repeat(61) }, 'payerName'],
      [{ payerChannel: 'CASH' }, 'payerChannel'],
      [{ transactionId: 'EP 123' }, 'transactionId'],
      [{ transactionId: 'EP_123' }, 'transactionId'],
      [{ transactionId: 'E'.repeat(41) }, 'transactionId'],
    ];
    for (const [extra, field] of cases) {
      const res = await request(tellUs(500000, extra)).expect(400);
      expect({ field, code: res.body.code, paths: res.body.details.fields.map((f: { path: string }) => f.path) }).toEqual({
        field,
        code: 'VALIDATION_FAILED',
        paths: [field],
      });
    }
    // Step 2.
    const othersFile = await uploadedPicture(std.DB.userId, std.DB.id);
    for (const proofFileId of [othersFile, randomUUID()]) {
      const res = await request(tellUs(500000, { proofFileId })).expect(404);
      expect(res.body).toMatchObject({ code: 'FILE_NOT_FOUND', message: "We couldn't find this file. Upload it again." });
    }
    expect(await db().payment.count()).toBe(0);
  });

  it('TOP-005 the pending request limit follows topup.maxPendingPerDistributor', async () => {
    // Step 1.
    const first = await request(tellUs(50000)).expect(201);
    await request(tellUs(50000)).expect(201);
    await request(tellUs(50000)).expect(201);
    const fourth = await request(tellUs(50000)).expect(409);
    expect(fourth.body).toMatchObject({
      code: 'TOPUP_TOO_MANY_PENDING',
      details: { count: 3 },
      message: 'Top-ups being checked: 3. Wait for them before sending another.',
    });
    // Step 2.
    await http().post(`/api/v1/payments/${first.body.id}/reject`).set(office()).send({ reasonCode: 'NOT_IN_BANK' }).expect(200);
    await request(tellUs(50000)).expect(201);
    // Step 3.
    await patchSetting('topup.maxPendingPerDistributor', 1, 'one at a time test').expect(200);
    const other = authHeader(std.DB.actor);
    await request(tellUs(50000), other).expect(201);
    const second = await request(tellUs(50000), other).expect(409);
    expect(second.body).toMatchObject({ code: 'TOPUP_TOO_MANY_PENDING', details: { count: 1 } });
    await patchSetting('topup.maxPendingPerDistributor', 3, 'back to three').expect(200);
    expect(await db().payment.count()).toBe(5);
  });

  it('TOP-006 the balance cap limits new requests and approvals; there is no cap by default', async () => {
    // Step 1.
    const big = await request(tellUs(5000000)).expect(201);
    await http().post(`/api/v1/payments/${big.body.id}/reject`).set(office()).send({ reasonCode: 'NOT_IN_BANK' }).expect(200);
    // Step 2.
    await patchSetting('wallet.maxBalancePaisa', 1000000, 'cap test').expect(200);
    // Step 3.
    const over = await request(tellUs(600000)).expect(409);
    expect(over.body).toMatchObject({
      code: 'TOPUP_WOULD_EXCEED_CAP',
      details: { capPaisa: '1000000', maxNowPaisa: '500000' },
      message: "Your balance can't go above Rs 10,000. You can add up to Rs 5,000 now.",
    });
    const fits = await request(tellUs(500000)).expect(201);
    expect((await http().get('/api/v1/payments/topup-info').set(shop()).expect(200)).body.limits.maxNowPaisa).toBe('0');
    // Step 4: the cap is checked against the credited amount.
    const approveBody = (bankAmountPaisa: number, bankReference: string) => ({ bankReference, bankAmountPaisa, bankTime: minutesAgo(2) });
    const tooMuch = await http().post(`/api/v1/payments/${fits.body.id}/approve`).set(office()).send(approveBody(600000, 'FT-0006-0001')).expect(409);
    expect(tooMuch.body).toMatchObject({ code: 'TOPUP_WOULD_EXCEED_CAP', details: { capPaisa: '1000000', maxNowPaisa: '500000' } });
    expect((await db().payment.findUniqueOrThrow({ where: { id: fits.body.id } })).status).toBe('PENDING');
    await http().post(`/api/v1/payments/${fits.body.id}/approve`).set(office()).send(approveBody(500000, 'FT-0006-0002')).expect(200);
    expect((await http().get('/api/v1/wallet').set(shop()).expect(200)).body).toMatchObject({ balancePaisa: '1000000', capPaisa: '1000000' });
    expect((await http().get('/api/v1/app/config').expect(200)).body.wallet.capPaisa).toBe('1000000');
    // Step 5.
    await patchSetting('wallet.maxBalancePaisa', null, 'cap back to none').expect(200);
    expect((await http().get('/api/v1/app/config').expect(200)).body.wallet.capPaisa).toBeNull();
  });

  it('TOP-007 a retried top-up request with the same Idempotency-Key creates one request', async () => {
    const K = key('b', 7);
    const body = tellUs(200000);
    // Step 1.
    const first = await request(body, shop(), K).expect(201);
    // Step 2.
    const again = await request(body, shop(), K).expect(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect([again.body.id, again.body.shortCode]).toEqual([first.body.id, first.body.shortCode]);
    const both = await Promise.all([request(body, shop(), K), request(body, shop(), K)]);
    for (const res of both) {
      expect([res.status, res.headers['idempotent-replay'], res.body.id]).toEqual([200, 'true', first.body.id]);
    }
    // Step 3.
    const changed = await request(tellUs(300000), shop(), K).expect(409);
    expect(changed.body).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', message: 'This was already sent with different details. Start again.' });
    // Step 4.
    expect(await db().payment.count({ where: { clientRequestId: K } })).toBe(1);
    expect((await auditRows('topup.request')).length).toBe(1);
    expect((await http().get('/api/v1/wallet').set(shop()).expect(200)).body.pendingTopupPaisa).toBe('200000');
  });

  it('TOP-007 two copies of a new request sent at the same moment create one request: one 201, one replay', async () => {
    for (let round = 1; round <= 5; round++) {
      await resetDb();
      std = await createStandardData();
      app.get(SettingsService).invalidate();
      await setCompanyAccount(app);
      const K = key('c', round);
      const [a, b] = await Promise.all([request(tellUs(200000), shop(), K), request(tellUs(200000), shop(), K)]);
      expect({ round, statuses: [a.status, b.status].sort() }).toEqual({ round, statuses: [200, 201] });
      expect(a.body.id).toBe(b.body.id);
      expect(await db().payment.count({ where: { clientRequestId: K } })).toBe(1);
      expect((await auditRows('topup.request')).length).toBe(1);
    }
  }, 180_000);

  it("TOP-008 payment routes refuse wrong roles and hide other distributors' requests", async () => {
    const fileId = await uploadedPicture(std.DA.userId, std.DA.id);
    const P = (await request(tellUs(500000, { proofFileId: fileId })).expect(201)).body;
    const other = authHeader(std.DB.actor);
    const driver = authHeader(std.DR1.actor);
    // Step 1.
    for (const who of [office(), driver]) {
      expect((await request(tellUs(500000), who).expect(403)).body.code).toBe('PERMISSION_DENIED');
    }
    // Step 2.
    const unknown = await http().get(`/api/v1/payments/${randomUUID()}`).set(other).expect(404);
    const hidden = await http().get(`/api/v1/payments/${P.id}`).set(other).expect(404);
    expect(hidden.body.code).toBe('NOT_FOUND');
    expect({ ...hidden.body, requestId: null, timestamp: null, path: null }).toEqual({ ...unknown.body, requestId: null, timestamp: null, path: null });
    const file = await http().get(`/api/v1/files/${fileId}/url`).set(other).expect(404);
    expect(file.body.code).toBe('FILE_NOT_FOUND');
    const proof = await http().post(`/api/v1/payments/${P.id}/bank-proof`).set(other).send({ proofUrl: 'uploads/2026-10-22/x.jpg' }).expect(404);
    expect(proof.body.code).toBe('NOT_FOUND');
    // Step 3.
    const own = await http().get(`/api/v1/payments/${P.id}`).set(shop()).expect(200);
    for (const officeOnly of ['bankReference', 'bankAmountPaisa', 'bankReceivedAt', 'reviewedBy', 'distributor']) {
      expect(own.body).not.toHaveProperty(officeOnly);
    }
    const seen = await http().get(`/api/v1/payments/${P.id}`).set(office()).expect(200);
    expect(seen.body).toMatchObject({
      distributor: { id: std.DA.id, businessName: 'Ahmed Gas', code: 'AG' },
      bankReference: null,
      bankAmountPaisa: null,
      bankReceivedAt: null,
      reviewedBy: null,
      allowedActions: ['APPROVE', 'REJECT'],
    });
    await http().get(`/api/v1/payments/${P.id}`).set(driver).expect(403);
    // Step 4.
    for (const who of [shop(), other, driver]) {
      await http().get('/api/v1/admin/topups').set(who).expect(403);
      await http().post(`/api/v1/payments/${P.id}/approve`).set(who).send({ bankReference: 'FT-1', bankAmountPaisa: 500000, bankTime: minutesAgo(1) }).expect(403);
      await http().post(`/api/v1/payments/${P.id}/reject`).set(who).send({ reasonCode: 'OTHER', note: 'self reject' }).expect(403);
    }
    expect((await db().payment.findUniqueOrThrow({ where: { id: P.id } })).status).toBe('PENDING');
    expect(await db().ledgerEntry.count({ where: { paymentId: P.id } })).toBe(0);
  });

  it('TOP-028 the quick top-up amounts follow the setting', async () => {
    // Step 1.
    expect((await http().get('/api/v1/payments/topup-info').set(shop()).expect(200)).body.quickAmountsPaisa).toEqual(['200000', '500000', '1000000']);
    expect((await http().get('/api/v1/app/config').expect(200)).body.topup.quickAmountsPaisa).toEqual(['200000', '500000', '1000000']);
    // Step 2.
    await patchSetting('topup.quickAmountsPaisa', [100000, 300000], 'Smaller chips test').expect(200);
    expect((await auditRows('setting.update')).some((row) => row.reason === 'Smaller chips test')).toBe(true);
    // Step 3.
    expect((await http().get('/api/v1/payments/topup-info').set(shop()).expect(200)).body.quickAmountsPaisa).toEqual(['100000', '300000']);
    expect((await http().get('/api/v1/app/config').expect(200)).body.topup.quickAmountsPaisa).toEqual(['100000', '300000']);
    // Step 4.
    const bad = await patchSetting('topup.quickAmountsPaisa', [100050], 'Not whole rupees').expect(400);
    expect(bad.body).toMatchObject({ code: 'SETTING_INVALID_VALUE', message: "This value isn't allowed here." });
    await patchSetting('topup.quickAmountsPaisa', [200000, 500000, 1000000], 'Back to the default chips').expect(200);
  });
});
