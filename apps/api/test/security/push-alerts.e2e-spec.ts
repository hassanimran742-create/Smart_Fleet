/**
 * Push tokens and alert rules (API_CONTRACT §7.2): SEC-028 and SEC-029.
 */
import type { INestApplication } from '@nestjs/common';
import { AlertRuleKind, AlertSeverity, AlertStatus, AlertType } from '@prisma/client';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { APP_BOOT_TIMEOUT_MS, TEST_TIMEOUT_MS } from './security-helpers';
import { http } from '../helpers/http';
import { createStandardData, type StandardData } from '../helpers/standard-data';
import { AlertsService } from '../../src/modules/alerts/alerts.service';

// Sign-ins hash with argon2 and the API boots once per suite: allow for a busy machine.
jest.setTimeout(TEST_TIMEOUT_MS);

describeDb('push tokens and alert rules', () => {
  let app: INestApplication;
  let std: StandardData;
  const db = () => getTestPrisma();

  beforeAll(async () => {
    app = await createTestApp();
  }, APP_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    await resetDb();
    std = await createStandardData();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('SEC-028 a user can remove only their own push token', async () => {
    const dr1 = authHeader(std.DR1.actor);
    const dr2 = authHeader(std.DR2.actor);
    await http(app).post('/api/v1/push-tokens').set(dr2).send({ token: 'ExponentPushToken[dr2-test]' }).expect(200);
    // Step 1.
    expect((await http(app).post('/api/v1/push-tokens').set(dr1).send({ token: 'ExponentPushToken[dr1-test]' }).expect(200)).body).toEqual({ ok: true });
    expect(await db().expoPushToken.count({ where: { userId: std.DR1.userId } })).toBe(1);
    // Step 2.
    expect((await http(app).delete('/api/v1/push-tokens').set(dr1).send({ token: 'ExponentPushToken[dr2-test]' }).expect(200)).body).toEqual({ removed: 0 });
    // Step 3.
    expect((await http(app).delete('/api/v1/push-tokens').set(dr1).send({ token: 'ExponentPushToken[dr1-test]' }).expect(200)).body).toEqual({ removed: 1 });
    // Step 4.
    const rows = await db().expoPushToken.findMany();
    expect(rows.map((row) => ({ token: row.token, userId: row.userId }))).toEqual([{ token: 'ExponentPushToken[dr2-test]', userId: std.DR2.userId }]);
    // A token registered on another user's phone moves to the caller (one phone, one signed-in user).
    await http(app).post('/api/v1/push-tokens').set(dr1).send({ token: 'ExponentPushToken[dr2-test]', platform: 'android' }).expect(200);
    expect((await db().expoPushToken.findUniqueOrThrow({ where: { token: 'ExponentPushToken[dr2-test]' } })).userId).toBe(std.DR1.userId);
    // A body without a token is refused.
    expect((await http(app).post('/api/v1/push-tokens').set(dr1).send({}).expect(400)).body.code).toBe('VALIDATION_FAILED');
  });

  it('SEC-029 alert rules are office only, and a \'credit over\' rule can\'t be created', async () => {
    const office = authHeader(std.SA1.actor);
    const old = await db().alertRule.create({
      data: {
        name: 'Credit over (from before the switch-over)',
        ruleKind: AlertRuleKind.DISTRIBUTOR_CREDIT_OVER,
        threshold: 100_000n,
        isActive: false,
        createdBy: std.SA1.id,
      },
    });
    // Step 1: listed as not active (inc1a backfill 12).
    const list = await http(app).get('/api/v1/alert-rules').set(office).expect(200);
    expect((list.body as Array<{ id: string; isActive: boolean }>).find((rule) => rule.id === old.id)).toMatchObject({ isActive: false });
    // Step 2.
    const create = await http(app)
      .post('/api/v1/alert-rules')
      .set(office)
      .send({ name: 'Credit over', ruleKind: 'DISTRIBUTOR_CREDIT_OVER', threshold: 50000 })
      .expect(400);
    expect(create.body.code).toBe('VALIDATION_FAILED');
    expect(create.body.details.fields).toEqual([expect.objectContaining({ path: 'ruleKind', code: 'NOT_ALLOWED' })]);
    expect(await db().alertRule.count()).toBe(1);
    // Step 3.
    const shop = authHeader(std.DA.actor);
    expect((await http(app).get('/api/v1/alert-rules').set(shop).expect(403)).body.code).toBe('PERMISSION_DENIED');
    const valid = { name: 'Low balance', ruleKind: 'DISTRIBUTOR_BALANCE_LOW', threshold: 100000 };
    expect((await http(app).post('/api/v1/alert-rules').set(shop).send(valid).expect(403)).body.code).toBe('PERMISSION_DENIED');
    expect((await http(app).get('/api/v1/alerts').set(shop).expect(403)).body.code).toBe('PERMISSION_DENIED');
    // Step 4.
    const activate = await http(app).patch(`/api/v1/alert-rules/${old.id}`).set(office).send({ isActive: true }).expect(400);
    expect(activate.body.code).toBe('VALIDATION_FAILED');
    expect(activate.body.details.fields).toEqual([expect.objectContaining({ path: 'isActive', code: 'NOT_ALLOWED' })]);
    expect((await db().alertRule.findUniqueOrThrow({ where: { id: old.id } })).isActive).toBe(false);
    // The office can still create a valid rule, and an old active credit-over rule never runs.
    await http(app).post('/api/v1/alert-rules').set(office).send(valid).expect(201);
    await db().alertRule.update({ where: { id: old.id }, data: { isActive: true, threshold: 0n } });
    await db().distributor.update({ where: { id: std.DA.id }, data: { advanceBalancePaisa: 0n } });
    await http(app).get('/api/v1/alerts').set(office).expect(200);
    expect(await db().alert.count({ where: { alertType: AlertType.DISTRIBUTOR_CREDIT_OVER } })).toBe(0);
  });

  it('SEC-029 alerts are raised once per resource, inside the caller\'s transaction when given one', async () => {
    const alerts = app.get(AlertsService);
    const input = {
      alertType: AlertType.WALLET_CHECK_MISMATCH,
      severity: AlertSeverity.CRITICAL,
      title: 'Wallet check',
      body: 'The ledger and the balance differ.',
      resourceType: 'Distributor',
      resourceId: std.DA.id,
      context: { balancePaisa: '500000', ledgerSumPaisa: '400000', differencePaisa: '100000' },
      dedupeKey: { resourceType: 'Distributor', resourceId: std.DA.id, alertType: AlertType.WALLET_CHECK_MISMATCH },
    };
    const first = await alerts.raise(input);
    const second = await alerts.raise({ ...input, context: { ...input.context, differencePaisa: '100001' } });
    expect(second.id).toBe(first.id);
    expect(await db().alert.count()).toBe(1);
    // A rolled-back transaction leaves no alert.
    await expect(
      db().$transaction(async (tx) => {
        await alerts.raise({ ...input, resourceId: std.DB.id, dedupeKey: { ...input.dedupeKey, resourceId: std.DB.id } }, tx);
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');
    expect(await db().alert.count()).toBe(1);
    // The office acknowledges and resolves it; repeats are already applied; an unknown id is 404.
    const office = authHeader(std.SA1.actor);
    const ack = await http(app).patch(`/api/v1/alerts/${first.id}/acknowledge`).set(office).expect(200);
    expect(ack.body.status).toBe(AlertStatus.ACKNOWLEDGED);
    expect((await http(app).patch(`/api/v1/alerts/${first.id}/acknowledge`).set(office).expect(200)).headers['x-already-applied']).toBe('true');
    expect((await http(app).patch(`/api/v1/alerts/${first.id}/resolve`).set(office).expect(200)).body.status).toBe(AlertStatus.RESOLVED);
    expect((await http(app).patch(`/api/v1/alerts/${first.id}/resolve`).set(office).expect(200)).headers['x-already-applied']).toBe('true');
    expect((await http(app).patch('/api/v1/alerts/00000000-0000-4000-8000-000000000000/resolve').set(office).expect(404)).body.code).toBe('NOT_FOUND');
    expect((await http(app).get('/api/v1/alerts/unread-count').set(office).expect(200)).body).toEqual({ count: 0 });
  });
});
