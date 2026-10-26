/**
 * Payment routes kept for the installed 0.1.0 apps and the old office screen (API_CONTRACT §7.2, §7.9,
 * Appendix A): the switched-off webhook, the legacy top-up, bank-proof and verify routes, and the
 * company account that only the logged CLI can change. TOP-025, TOP-026 and TOP-027.
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
import { auditRows, balanceOf, key, seedTopup, setCompanyAccount } from './money-fixtures';

describeDb('money: legacy payment routes', () => {
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

  async function upload(userId: string): Promise<{ id: string; storageKey: string }> {
    return db().storedFile.create({
      data: {
        storageKey: `uploads/2026-10-22/${randomUUID()}.jpg`,
        purpose: 'TOPUP_PROOF',
        mimeType: 'image/jpeg',
        sizeBytes: 4096,
        sha256: randomUUID().replace(/-/g, '').padEnd(64, '1'),
        uploadedByUserId: userId,
      },
      select: { id: true, storageKey: true },
    });
  }

  it('TOP-025 the payment webhook is switched off: 410, and no payment changes', async () => {
    const P = await seedTopup({ distributor: std.DA, amountPaisa: 500_000n });
    const before = await db().payment.findUniqueOrThrow({ where: { id: P.id } });
    const claim = { paymentId: P.id, status: 'PAID', amount: 500000, orderRefNum: P.id, pp_TxnRefNo: P.id, pp_ResponseCode: '000' };
    // Steps 1 and 2.
    const calls = [
      await http().post('/api/v1/payments/webhook/easypaisa').send(claim),
      await http().post('/api/v1/payments/webhook/EASYPAISA').send(claim),
      await http().post('/api/v1/payments/webhook/BANK_MANUAL').send(claim),
      await http().post('/api/v1/payments/webhook/jazzcash').send(claim),
      await http().post('/api/v1/payments/webhook/easypaisa').set(shop()).send(claim),
    ];
    for (const res of calls) {
      expect({ status: res.status, code: res.body.code, message: res.body.message }).toEqual({
        status: 410,
        code: 'PAYMENT_WEBHOOK_DISABLED',
        message: 'Online payments are switched off.',
      });
    }
    // Step 3.
    const seen = await http().get(`/api/v1/payments/${P.id}`).set(office()).expect(200);
    expect(seen.body.status).toBe('PENDING');
    expect(await db().payment.findUniqueOrThrow({ where: { id: P.id } })).toEqual(before);
    expect(before.providerTxnId).toBeNull();
    expect(await db().ledgerEntry.count({ where: { paymentId: P.id } })).toBe(0);
    expect((await auditRows('topup.approve')).length).toBe(0);
    expect((await http().get('/api/v1/wallet').set(shop()).expect(200)).body.balancePaisa).toBe('500000');
  });

  it('TOP-026 the legacy top-up routes for installed apps follow the new money rules', async () => {
    // Step 1: the old Rs 100 minimum (the installed app sends provider BANK_MANUAL).
    const small = await http().post('/api/v1/payments/topup').set(shop()).send({ amountPaisa: 10000, provider: 'BANK_MANUAL' }).expect(400);
    expect(small.body).toMatchObject({ code: 'TOPUP_AMOUNT_TOO_SMALL', message: 'The minimum top-up is Rs 500.' });
    // Step 2.
    const started = await http().post('/api/v1/payments/topup').set(shop()).send({ amountPaisa: 500000, provider: 'BANK_MANUAL' }).expect(201);
    expect(Object.keys(started.body).sort()).toEqual(['formFields', 'paymentId']);
    const text: string = started.body.formFields.instructions;
    expect(text).toContain(DUMMY_COMPANY_ACCOUNT.accountTitle);
    expect(text).toContain(DUMMY_COMPANY_ACCOUNT.iban);
    expect(text).toContain('Rs 5,000');
    expect(text).toContain('AG-T001');
    expect(text).not.toMatch(/NIONSSTECH|Bank Al Habib|PK96BAHL/);
    const row = await db().payment.findUniqueOrThrow({ where: { id: started.body.paymentId } });
    expect(row).toMatchObject({ provider: 'BANK_MANUAL', status: 'PENDING', payerName: null, providerTxnId: null, requestNo: 1 });
    // Other providers can't start a top-up.
    const gateway = await http().post('/api/v1/payments/topup').set(shop()).send({ amountPaisa: 500000, provider: 'JAZZCASH' }).expect(410);
    expect(gateway.body.code).toBe('PAYMENT_WEBHOOK_DISABLED');
    // Step 3.
    const mine = await upload(std.DA.userId);
    const attached = await http()
      .post(`/api/v1/payments/${row.id}/bank-proof`)
      .set(shop())
      .send({ proofUrl: `http://localhost:9000/smartfleet/${mine.storageKey}` })
      .expect(200);
    expect(attached.body).toMatchObject({ id: row.id, status: 'PENDING' });
    expect(attached.body.proofUrl).toEqual(expect.stringContaining(mine.storageKey));
    expect((await db().payment.findUniqueOrThrow({ where: { id: row.id } })).proofFileId).toBe(mine.id);
    const other = await http().post(`/api/v1/payments/${row.id}/bank-proof`).set(authHeader(std.DB.actor)).send({ proofUrl: mine.storageKey }).expect(404);
    expect(other.body.code).toBe('NOT_FOUND');
    // Someone else's upload can't be attached.
    const theirs = await upload(std.DB.userId);
    expect((await http().post(`/api/v1/payments/${row.id}/bank-proof`).set(shop()).send({ proofUrl: theirs.storageKey }).expect(404)).body.code).toBe(
      'FILE_NOT_FOUND',
    );
    // Step 4.
    const yes = await http().post(`/api/v1/payments/${row.id}/verify`).set(office()).send({ approve: true }).expect(400);
    expect(yes.body.code).toBe('TOPUP_BANK_REFERENCE_REQUIRED');
    expect(await balanceOf(std.DA.id)).toBe(500_000n);
    const loose = await http().post(`/api/v1/payments/${row.id}/verify`).set(office()).send({ approve: 'yes' }).expect(400);
    expect(loose.body.code).toBe('VALIDATION_FAILED');
    const no = await http().post(`/api/v1/payments/${row.id}/verify`).set(office()).send({ approve: false }).expect(200);
    expect(no.body.payment).toMatchObject({ status: 'REJECTED', rejectReasonCode: 'OTHER', rejectNote: 'Call the office for the reason.' });
    const audits = await auditRows('topup.reject');
    expect(audits).toHaveLength(1);
    expect(audits[0].reason).toBe('Rejected through the legacy verify route');
    expect(await db().ledgerEntry.count({ where: { paymentId: row.id } })).toBe(0);
    // A proof can't be attached once the request was handled.
    expect((await http().post(`/api/v1/payments/${row.id}/bank-proof`).set(shop()).send({ proofUrl: mine.storageKey }).expect(409)).body.code).toBe(
      'TOPUP_NOT_PENDING',
    );
    // The legacy verify is office only (DISPATCHER no longer gets in).
    await http().post(`/api/v1/payments/${row.id}/verify`).set(shop()).send({ approve: false }).expect(403);
  });

  it('TOP-026 the old office list keeps its shape, office only, and its "Rejected" filter finds new rejections', async () => {
    const pending = await seedTopup({ distributor: std.DA, amountPaisa: 200_000n });
    const rejected = await seedTopup({ distributor: std.DB, amountPaisa: 100_000n, status: 'REJECTED', completedAt: new Date() });
    const all = await http().get('/api/v1/payments').set(office()).expect(200);
    expect((all.body as Array<{ id: string }>).map((p) => p.id).sort()).toEqual([pending.id, rejected.id].sort());
    const one = (all.body as Array<Record<string, any>>).find((p) => p.id === pending.id);
    expect(one).toMatchObject({
      amountPaisa: '200000',
      provider: 'BANK_MANUAL',
      status: 'PENDING',
      distributor: { businessName: 'Ahmed Gas', user: { name: 'Ahmed Gas', phone: '+923211234567' } },
    });
    expect(JSON.stringify(all.body)).not.toMatch(/passwordHash|cnic|tokenHash/);
    expect(((await http().get('/api/v1/payments?status=PENDING').set(office()).expect(200)).body as Array<{ id: string }>).map((p) => p.id)).toEqual([pending.id]);
    expect(((await http().get('/api/v1/payments?status=FAILED').set(office()).expect(200)).body as Array<{ id: string }>).map((p) => p.id)).toEqual([rejected.id]);
    await http().get('/api/v1/payments?status=MAYBE').set(office()).expect(400);
    await http().get('/api/v1/payments').set(shop()).expect(403);
  });

  it("TOP-027 the company bank account can't be changed over the API; the logged CLI change is what the shop sees", async () => {
    // Step 1.
    const refused = await http()
      .patch('/api/v1/settings/topup.account')
      .set(office())
      .send({ value: { accountTitle: 'Other Ltd', bankName: 'X', iban: 'PK99XXXX0000000000000000', accountNumber: '1' }, reason: 'change test' })
      .expect(403);
    expect(refused.body).toMatchObject({ code: 'SETTING_NOT_EDITABLE', message: "This setting can't be changed here." });
    // Step 2. (The case's reason "test" is shorter than the 5 characters every reason needs, which is a
    // 400 before the setting is looked at; a valid reason shows the refusal the case is about.)
    for (const [k, value] of [
      ['topup.secondApproval', { enabled: true, thresholdPaisa: 2000000 }],
      ['refill.deliveryCost', { enabled: true, basePaisa: 10000, perCylinderPaisa: 0 }],
    ] as const) {
      const res = await http().patch(`/api/v1/settings/${k}`).set(office()).send({ value, reason: 'not editable test' }).expect(403);
      expect(res.body.code).toBe('SETTING_NOT_EDITABLE');
    }
    expect((await auditRows('setting.update')).filter((row) => row.actorUserId === std.SA1.id)).toHaveLength(0);
    // Step 3.
    const list = await http().get('/api/v1/settings').set(office()).expect(200);
    for (const k of ['topup.account', 'topup.secondApproval', 'refill.deliveryCost']) {
      expect((list.body as Array<{ key: string; editable: boolean }>).find((row) => row.key === k)?.editable).toBe(false);
    }
    expect((await http().get('/api/v1/payments/topup-info').set(shop()).expect(200)).body.account).toEqual({ ...DUMMY_COMPANY_ACCOUNT });
    // Step 4: the CLI's change (SYSTEM, cli:settings, with a reason) is what the shop sees next.
    const changed = { accountTitle: 'Smart Fleet Training Ltd', bankName: 'Test Bank 2', iban: 'PK00TEST0000000000000002', accountNumber: '0000000002' };
    await setCompanyAccount(app, changed);
    const cli = (await auditRows('setting.update')).filter((row) => row.actorLabel === 'cli:settings');
    expect(cli[cli.length - 1]).toMatchObject({ actorKind: 'SYSTEM', reason: 'Money test setup' });
    expect((await http().get('/api/v1/payments/topup-info').set(shop()).expect(200)).body.account).toEqual(changed);
    await setCompanyAccount(app);
  });

  it('a malformed Idempotency-Key on a money route is refused before anything is written', async () => {
    const res = await http()
      .post('/api/v1/payments/topup-requests')
      .set(shop())
      .set('Idempotency-Key', 'not-a-uuid')
      .send({ amountPaisa: 500000, payerName: 'Ahmed Raza', payerChannel: 'BANK_APP' })
      .expect(400);
    expect(res.body.details.fields[0]).toMatchObject({ path: 'Idempotency-Key', code: 'INVALID_ID' });
    const approve = await http()
      .post(`/api/v1/payments/${key('d', 1)}/approve`)
      .set(office())
      .set('Idempotency-Key', 'nope')
      .send({ bankReference: 'FT-1', bankAmountPaisa: 500000, bankTime: new Date().toISOString() })
      .expect(400);
    expect(approve.body.code).toBe('VALIDATION_FAILED');
    expect(await db().payment.count()).toBe(0);
  });
});
