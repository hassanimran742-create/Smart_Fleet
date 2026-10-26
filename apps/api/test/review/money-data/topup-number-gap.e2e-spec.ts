/**
 * Review finding (data integrity, low): a duplicate top-up request burns a top-up number.
 *
 * ADR-22: human numbers come from counters "allocated inside the creating transaction". When two
 * copies of one request (same Idempotency-Key) arrive together, the loser waits on the distributor row,
 * increments `next_topup_no`, finds the winner's row and returns it as a replay
 * (topup.service.ts createPending, the "twin" branch) - and that transaction commits the increment. The
 * order route rolls the counter back in the same situation (the INSERT fails and the transaction
 * rolls back), so only top-ups get gaps.
 *
 * Fixed (money-data-05): createPending locks the distributor row first, then re-checks the key, and
 * only then takes a number, so a twin is replayed without using one up.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { systemActor } from '../../../src/common/auth/actor';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { createStandardData, DUMMY_COMPANY_ACCOUNT } from '../../helpers/standard-data';
import { OrdersFixture, together } from '../../orders/support/fixture';
import { createOrdersTestApp, freshSettings } from '../../orders/support/orders-app';

jest.setTimeout(120_000);

describeDb('review money-data: top-up numbers', () => {
  let app: INestApplication;
  let f: OrdersFixture;

  beforeAll(async () => {
    app = await createOrdersTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    freshSettings(app);
    f = new OrdersFixture(app, await createStandardData());
    await app.get(SettingsService).set('topup.account', { ...DUMMY_COMPANY_ACCOUNT }, systemActor('cli:settings'), 'review setup', {
      allowNotEditable: true,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('two copies of one request (same Idempotency-Key) leave the next request numbered AG-T002', async () => {
    const { std } = f;
    const key = randomUUID();
    const body = { amountPaisa: '500000', payerName: 'Ahmed Raza', payerChannel: 'BANK_APP' };
    const send = (k: string) => f.as(std.DA).post('/payments/topup-requests').set('Idempotency-Key', k).send(body);
    const [a, b] = await together(send(key), send(key));
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.shortCode).toBe('AG-T001');
    const next = await send(randomUUID()).expect(201);
    const numbers = (await f.db.payment.findMany({ where: { distributorId: std.DA.id }, orderBy: { requestNo: 'asc' } })).map((p) => p.requestNo);
    expect({ numbers, next: next.body.shortCode }).toEqual({ numbers: [1, 2], next: 'AG-T002' });
  });
});
