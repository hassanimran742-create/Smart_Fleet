/**
 * Regression tests for verified review findings fixed in the money modules (the confirming tests live
 * under test/review/money-data). Each case is named after its finding.
 *
 * - money-data-05: two copies of one top-up request (same Idempotency-Key) that wait for each other use
 *   one AG-T number, so the next request is numbered without a gap (ADR-22).
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { createTestApp } from '../helpers/app';
import { authHeader } from '../helpers/auth';
import { getTestPrisma, resetDb } from '../helpers/db';
import { describeDb } from '../helpers/describe-db';
import { http } from '../helpers/http';
import { createStandardData, type StandardData } from '../helpers/standard-data';
import { together } from '../orders/support/fixture';
import { holdRowLock, waitForLockWaiters } from '../orders/support/row-lock';
import { setCompanyAccount } from './money-fixtures';

describeDb('money: review fixes', () => {
  let app: INestApplication;
  let std: StandardData;
  const db = () => getTestPrisma();

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

  it('REV money-data-05 two copies of one top-up request queued on the shop\'s row use one AG-T number; the next request is AG-T002', async () => {
    const body = { amountPaisa: '500000', payerName: 'Ahmed Raza', payerChannel: 'BANK_APP' };
    const send = (key: string) => http(app).post('/api/v1/payments/topup-requests').set(authHeader(std.DA.actor)).set('Idempotency-Key', key).send(body);
    const twin = randomUUID();

    // Ahmed Gas's row is held until both copies wait for it (an app resend after its 15 s timeout), so
    // the second copy gets the row only after the first committed its request.
    const holder = await holdRowLock((tx) => tx.$queryRaw`SELECT id FROM distributors WHERE id = ${std.DA.id}::uuid FOR UPDATE`);
    const copies = together(send(twin), send(twin));
    try {
      await waitForLockWaiters(holder, 'distributors', 2);
    } finally {
      await holder.release();
    }
    const [a, b] = await copies;
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect({ sameRequest: a.body.id === b.body.id, shortCode: a.body.shortCode }).toEqual({ sameRequest: true, shortCode: 'AG-T001' });
    const replay = a.status === 200 ? a : b;
    expect(replay.headers['idempotent-replay']).toBe('true');

    // The replay used no number: the next request is AG-T002, and the counter stands at 3.
    const next = await send(randomUUID()).expect(201);
    const numbers = (await db().payment.findMany({ where: { distributorId: std.DA.id }, orderBy: { requestNo: 'asc' } })).map((p) => p.requestNo);
    const counter = (await db().distributor.findUniqueOrThrow({ where: { id: std.DA.id } })).nextTopupNo;
    expect({ numbers, next: next.body.shortCode, counter }).toEqual({ numbers: [1, 2], next: 'AG-T002', counter: 3 });
  });
});
