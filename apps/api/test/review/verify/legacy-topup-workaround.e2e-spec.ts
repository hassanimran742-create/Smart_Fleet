/**
 * Verifier check for review finding money-data-08: can the office approve an old PENDING top-up whose
 * whole-rupee amount is outside today's limits, by widening the editable limits (topup.minPaisa /
 * topup.maxPaisa, API_CONTRACT §6 "Edit: yes") for the approval and restoring them afterwards?
 */
import type { INestApplication } from '@nestjs/common';
import { systemActor } from '../../../src/common/auth/actor';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { createStandardData, DUMMY_COMPANY_ACCOUNT } from '../../helpers/standard-data';
import { seedTopup } from '../../money/money-fixtures';
import { OrdersFixture } from '../../orders/support/fixture';
import { createOrdersTestApp, freshSettings } from '../../orders/support/orders-app';

jest.setTimeout(120_000);

describeDb('verify money-data-08: widening the editable top-up limits', () => {
  let app: INestApplication;
  let f: OrdersFixture;

  beforeAll(async () => {
    app = await createOrdersTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    freshSettings(app);
    f = new OrdersFixture(app, await createStandardData());
    await app.get(SettingsService).set('topup.account', { ...DUMMY_COMPANY_ACCOUNT }, systemActor('cli:settings'), 'verify setup', {
      allowNotEditable: true,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  const approve = (id: string, bankAmountPaisa: string, ref: string) =>
    f.as(f.std.SA1).post(`/payments/${id}/approve`).send({ bankReference: ref, bankAmountPaisa, bankTime: new Date(Date.now() - 3_600_000).toISOString() });

  it('the office widens the limits from the settings API, approves both old requests, then restores the limits', async () => {
    const { std } = f;
    const small = await seedTopup({ distributor: std.DA, amountPaisa: 30_000n, payerName: null });
    const large = await seedTopup({ distributor: std.DA, amountPaisa: 6_000_000n, payerName: null });
    const reason = 'Approve requests left from the old app';
    await f.as(std.SA1).patch('/settings/topup.minPaisa').send({ value: 10_000, reason }).expect(200);
    await f.as(std.SA1).patch('/settings/topup.maxPaisa').send({ value: 10_000_000, reason }).expect(200);
    const results = [await approve(small.id, '30000', 'FT-OLD-0001'), await approve(large.id, '6000000', 'FT-OLD-0002')];
    await f.as(std.SA1).patch('/settings/topup.maxPaisa').send({ value: 5_000_000, reason: 'Back to the pilot limits' }).expect(200);
    await f.as(std.SA1).patch('/settings/topup.minPaisa').send({ value: 50_000, reason: 'Back to the pilot limits' }).expect(200);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    await f.expectWalletsConsistent();
  });
});
