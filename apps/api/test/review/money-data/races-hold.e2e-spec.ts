/**
 * Review (money and data integrity): races the Inc 1 suites don't cover directly, proved safe here by
 * parallel HTTP requests. These pass on the current code and guard against regressions.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { systemActor } from '../../../src/common/auth/actor';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { createStandardData, DUMMY_COMPANY_ACCOUNT } from '../../helpers/standard-data';
import { OrdersFixture, newKey, together } from '../../orders/support/fixture';
import { createOrdersTestApp, freshSettings } from '../../orders/support/orders-app';

jest.setTimeout(300_000);

describeDb('review money-data: races that hold', () => {
  let app: INestApplication;
  let f: OrdersFixture;

  beforeAll(async () => {
    app = await createOrdersTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    freshSettings(app);
    f = new OrdersFixture(app, await createStandardData({ cylinders: true }));
    await app.get(SettingsService).set('topup.account', { ...DUMMY_COMPANY_ACCOUNT }, systemActor('cli:settings'), 'review setup', {
      allowNotEditable: true,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a cancel racing the driver arriving at the customer never refunds after an arrival that came first', async () => {
    const { std } = f;
    await f.setBalance(std.DA, 25n * 48_000n);
    let bad = 0;
    for (let round = 0; round < 25; round++) {
      const x1 = await f.x1();
      const { tripId } = await f.assign(x1.id, std.DR1);
      const delivery = (await f.stops(tripId)).find((s) => s.stopType === 'DELIVERY')!;
      const [cancel, arrive] = await together(
        f.cancel(x1.id, { reasonCode: 'CUSTOMER_CANCELLED' }),
        f.as(std.DR1).patch(`/trips/stops/${delivery.id}/arrive`),
      );
      expect(cancel.status).toBe(200);
      expect([200, 409]).toContain(arrive.status);
      const stop = await f.db.tripStop.findUniqueOrThrow({ where: { id: delivery.id } });
      const order = await f.order(x1.id);
      if (cancel.body.refundedPaisa === '48000' && stop.arrivedAt && order.cancelledAt && stop.arrivedAt < order.cancelledAt) bad += 1;
    }
    expect(bad).toBe(0);
    await f.expectWalletsConsistent();
  });

  it('approve, reject, an order and two corrections racing on one wallet stay consistent', async () => {
    const { std } = f;
    for (let round = 0; round < 10; round++) {
      const pay = await f.as(std.DA).post('/payments/topup-requests').set('Idempotency-Key', randomUUID())
        .send({ amountPaisa: '50000', payerName: 'Ahmed Raza', payerChannel: 'BANK_APP' }).expect(201);
      const results = await together(
        f.as(std.SA1).post(`/payments/${pay.body.id}/approve`)
          .send({ bankReference: `FT${round}X${Date.now()}`, bankAmountPaisa: '50000', bankTime: new Date(Date.now() - 60_000).toISOString() }),
        f.as(std.SA2).post(`/payments/${pay.body.id}/reject`).send({ reasonCode: 'NOT_IN_BANK' }),
        f.placeX1(),
        f.as(std.SA1).post(`/admin/distributors/${std.DA.id}/wallet/corrections`).set('Idempotency-Key', randomUUID())
          .send({ direction: 'TAKE', amountPaisa: '10000', reasonCode: 'OTHER', note: 'review race take' }),
        f.as(std.SA2).post(`/admin/distributors/${std.DA.id}/wallet/corrections`).set('Idempotency-Key', randomUUID())
          .send({ direction: 'ADD', amountPaisa: '10000', reasonCode: 'OTHER', note: 'review race add' }),
      );
      for (const r of results) expect(r.status).toBeLessThan(500);
      expect([results[0].status, results[1].status].sort()).toEqual([200, 409]);
    }
    await f.expectWalletsConsistent();
  });

  it('a cancel and a new order racing for the same last Rs 480 never overdraw and never lose the refund', async () => {
    const { std } = f;
    for (let round = 0; round < 15; round++) {
      await f.setBalance(std.DA, 48_000n);
      const a = await f.x1();
      expect(await f.balance()).toBe(0n);
      const [cancel, place] = await together(f.cancel(a.id, { reasonCode: 'CUSTOMER_CANCELLED' }), f.placeX1(newKey()));
      expect(cancel.status).toBe(200);
      const balance = await f.balance();
      if (place.status === 201) {
        expect({ round, balance }).toEqual({ round, balance: 0n });
        await f.cancel(place.body.id, { reasonCode: 'CUSTOMER_CANCELLED' }).expect(200);
      } else {
        expect({ round, code: place.body.code, balance }).toEqual({ round, code: 'WALLET_INSUFFICIENT_BALANCE', balance: 48_000n });
      }
    }
    await f.expectWalletsConsistent();
  });
});
