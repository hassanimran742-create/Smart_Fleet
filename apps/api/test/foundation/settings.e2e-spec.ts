/**
 * FND-002 and FND-003: settings changes are audited, applied to the very next request, and refused
 * whole when they are wrong (API_CONTRACT §5.2, §6, §7.13).
 */
import type { INestApplication } from '@nestjs/common';
import { systemActor } from '../../src/common/auth/actor';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http as client } from '../helpers/http';
import { createStandardData, DUMMY_COMPANY_ACCOUNT, type StandardData } from '../helpers/standard-data';

const KEY = 'orders.maxCylindersPerOrder';

describeDb('foundation: settings', () => {
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
  const office = () => authHeader(std.SA1.actor);

  async function settingUpdates() {
    return getTestPrisma().auditLog.findMany({ where: { action: 'setting.update' }, orderBy: { createdAt: 'asc' } });
  }

  it('FND-002 a settings change is audited and used by the very next request (settings, audit and /app/config)', async () => {
    // Step 1.
    const list = await http().get('/api/v1/settings').set(office()).expect(200);
    const row = (list.body as Array<Record<string, unknown>>).find((r) => r.key === KEY);
    expect(row).toMatchObject({ key: KEY, value: 30, default: 30, min: 1, max: 100, editable: true, public: true, updatedBy: null });
    expect(String(row?.type)).toMatch(/^int/);

    // Step 2.
    const patched = await http().patch(`/api/v1/settings/${KEY}`).set(office()).send({ value: 5, reason: 'Rehearsal limit test' }).expect(200);
    const requestId = patched.headers['x-request-id'];
    expect(patched.body).toMatchObject({ key: KEY, value: 5, updatedBy: { id: std.SA1.id, name: 'Owner' } });
    expect(Date.parse(patched.body.updatedAt)).not.toBeNaN();

    // Step 3: the very next request sees it.
    const config = await http().get('/api/v1/app/config').expect(200);
    expect(config.body.orders.maxCylindersPerOrder).toBe(5);

    // Step 6.
    const logs = await http().get('/api/v1/audit-logs').query({ action: 'setting.update' }).set(office()).expect(200);
    expect(logs.body.items).toHaveLength(1);
    expect(logs.body.items[0]).toMatchObject({
      action: 'setting.update',
      actor: { kind: 'USER', userId: std.SA1.id, name: 'Owner' },
      reason: 'Rehearsal limit test',
      diff: expect.objectContaining({ key: KEY, from: 30, to: 5 }),
    });
    const [stored] = await settingUpdates();
    expect(stored.requestId).toBe(requestId);

    // Step 7.
    await http().patch(`/api/v1/settings/${KEY}`).set(office()).send({ value: 30, reason: 'Restore default after test' }).expect(200);
    const rows = await settingUpdates();
    expect(rows).toHaveLength(2);
    expect(rows[1].diff).toMatchObject({ key: KEY, from: 5, to: 30 });
    expect((await http().get('/api/v1/app/config').expect(200)).body.orders.maxCylindersPerOrder).toBe(30);
  });

  it('FND-002 the new order limit applies to the very next order and quote', async () => {
    await http().patch(`/api/v1/settings/${KEY}`).set(office()).send({ value: 5, reason: 'Rehearsal limit test' }).expect(200);
    const six = {
      clientId: std.C1.id,
      addressId: std.C1.addressId,
      deliveryLabel: "Sana's house",
      lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 6, expectedReturnCount: 6 }],
    };
    const refused = await http()
      .post('/api/v1/orders')
      .set(authHeader(std.DA.actor))
      .set('Idempotency-Key', '6f1c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f')
      .send(six)
      .expect(400);
    expect(refused.body).toMatchObject({
      code: 'ORDER_TOO_MANY_CYLINDERS',
      message: 'Too many cylinders. An order can have at most 5.',
      details: { max: 5 },
    });
    expect(await getTestPrisma().order.count()).toBe(0);
    const wallet = await http().get('/api/v1/wallet').set(authHeader(std.DA.actor)).expect(200);
    expect(wallet.body.balancePaisa).toBe('500000');

    const five = { ...six, lines: [{ cylinderTypeId: std.sizes.kg11_8, fullCount: 5, expectedReturnCount: 5 }] };
    const quote = await http().post('/api/v1/orders/quote').set(authHeader(std.DA.actor)).send(five).expect(200);
    expect(quote.body.quote.totalPaisa).toBe('45000');
    expect(quote.body.wallet.enough).toBe(true);
  });

  it('FND-003 a refused settings change changes nothing and writes no audit row', async () => {
    const settings = app.get(SettingsService);
    // The settings CLI sets the dummy company account (actor SYSTEM, cli:settings).
    await settings.set('topup.account', DUMMY_COMPANY_ACCOUNT, systemActor('cli:settings'), 'Rehearsal company account', {
      allowNotEditable: true,
    });
    const before = (await settingUpdates()).length;
    const patch = (key: string, body: Record<string, unknown>) => http().patch(`/api/v1/settings/${key}`).set(office()).send(body);

    // Steps 1–3.
    for (const value of [0, 101, 'abc']) {
      const res = await patch(KEY, { value, reason: 'Boundary test' }).expect(400);
      expect(res.body).toMatchObject({ code: 'SETTING_INVALID_VALUE', message: "This value isn't allowed here." });
    }
    expect((await patch('orders.deliveryStartedAt', { value: 'ON_DELIVERY', reason: 'Bad value test' }).expect(400)).body.code).toBe(
      'SETTING_INVALID_VALUE',
    );
    expect((await patch('app.minVersion.distributor', { value: '1.0', reason: 'Bad version test' }).expect(400)).body.code).toBe(
      'SETTING_INVALID_VALUE',
    );

    // Step 4.
    for (const body of [{ value: 20 }, { value: 20, reason: 'abc' }]) {
      const res = await patch(KEY, body).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.details.fields).toEqual([expect.objectContaining({ path: 'reason' })]);
    }

    // Step 5.
    const unknown = await patch('orders.notARealKey', { value: 1, reason: 'Unknown key test' }).expect(404);
    expect(unknown.body).toMatchObject({ code: 'SETTING_UNKNOWN', message: 'Unknown setting.' });

    // Step 6: five keys that only the CLI (or nobody) may change.
    const other = { accountTitle: 'Someone Else', bankName: 'Other Bank', iban: 'PK00OTHR0000000000000001', accountNumber: '1' };
    const attempts: [string, unknown][] = [
      ['topup.account', other],
      ['pricing.deliveryStrategy', 'DISTRIBUTOR_ZONE'],
      ['refill.deliveryCost', { enabled: true, basePaisa: 10000, perCylinderPaisa: 0 }],
      ['topup.secondApproval', { enabled: true, thresholdPaisa: 1000000 }],
      ['auth.otpLogin.enabled', true],
    ];
    for (const [key, value] of attempts) {
      const res = await patch(key, { value, reason: 'Not editable test' }).expect(403);
      expect({ key, body: res.body }).toMatchObject({
        key,
        body: { code: 'SETTING_NOT_EDITABLE', message: "This setting can't be changed here." },
      });
    }

    // Step 7: nothing changed and nothing was audited.
    const list = await http().get('/api/v1/settings').set(office()).expect(200);
    const value = (key: string) => (list.body as Array<{ key: string; value: unknown }>).find((r) => r.key === key)?.value;
    expect(value(KEY)).toBe(30);
    expect(value('orders.deliveryStartedAt')).toBe('FIRST_LOAD_SCAN');
    expect(value('app.minVersion.distributor')).toBe('0.0.0');
    expect(value('auth.otpLogin.enabled')).toBe(false);
    expect(value('topup.account')).toMatchObject({ accountTitle: 'Smart Fleet (Pvt) Ltd', iban: 'PK00TEST0000000000000000' });
    expect((await settingUpdates()).length).toBe(before);
  });

  it('FND-003 the distributor still sees the dummy company account after the refused changes', async () => {
    await app.get(SettingsService).set('topup.account', DUMMY_COMPANY_ACCOUNT, systemActor('cli:settings'), 'Rehearsal company account', {
      allowNotEditable: true,
    });
    await http()
      .patch('/api/v1/settings/topup.account')
      .set(office())
      .send({ value: { accountTitle: 'Someone Else', bankName: 'Other Bank', iban: 'PK00OTHR0000000000000001', accountNumber: '1' }, reason: 'Not editable test' })
      .expect(403);
    const info = await http().get('/api/v1/payments/topup-info').set(authHeader(std.DA.actor)).expect(200);
    expect(info.body.account).toMatchObject({ accountTitle: 'Smart Fleet (Pvt) Ltd', iban: 'PK00TEST0000000000000000' });
  });
});
