/**
 * Review finding (money): a reassignment makes a started order refundable again.
 *
 * ADR-07 / API_CONTRACT §5.5: under FIRST_LOAD_SCAN (and LEFT_STORE) delivery has started once "the
 * order's delivery stop was reached", and a cancel after the start returns nothing. The office may still
 * change the driver then (REASSIGN is offered while nothing is loaded, §1.6 / ADR-12). The fee policy
 * only read the order's *current* trip (orders-fee.policy.ts loadOrdersForPolicy), so after the
 * reassignment the old trip's arrival was forgotten and the cancel returned the whole cost.
 *
 * These tests state the documented rule. Fixed (money-data-01): loadOrdersForPolicy takes the arrival
 * from any DELIVERY stop of the order, on any trip (a cancelled stop keeps `arrived_at`).
 */
import type { INestApplication } from '@nestjs/common';
import { systemActor } from '../../../src/common/auth/actor';
import { SettingsService } from '../../../src/modules/settings/settings.service';
import { resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { createStandardData } from '../../helpers/standard-data';
import { OrdersFixture, type OrderBody } from '../../orders/support/fixture';
import { createOrdersTestApp, freshSettings } from '../../orders/support/orders-app';

jest.setTimeout(120_000);

describeDb('review money-data: refund after a reassignment', () => {
  let app: INestApplication;
  let f: OrdersFixture;

  beforeAll(async () => {
    app = await createOrdersTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    freshSettings(app);
    f = new OrdersFixture(app, await createStandardData({ cylinders: true }));
  });

  afterAll(async () => {
    await app?.close();
  });

  async function arriveThenReassign(): Promise<{ orderId: string; before: OrderBody; after: OrderBody; reassignStatus: number }> {
    const { std } = f;
    const x1 = await f.x1();
    const { tripId } = await f.assign(x1.id, std.DR1);
    const delivery = (await f.stops(tripId)).find((stop) => stop.stopType === 'DELIVERY')!;
    // Kashif taps "I arrived" at Sana's (the installed DeliverySteps "I arrived" button), nothing loaded.
    await f.as(std.DR1).patch(`/trips/stops/${delivery.id}/arrive`).expect(200);
    const before = (await f.as(std.DA).get(`/orders/${x1.id}`).expect(200)).body as OrderBody;
    // The office changes the driver: allowed, because nothing was loaded.
    const reassign = await f.as(std.SA1).post(`/orders/${x1.id}/assign-driver`).send({ driverId: std.DR2.id });
    const after = (await f.as(std.DA).get(`/orders/${x1.id}`).expect(200)).body as OrderBody;
    return { orderId: x1.id, before, after, reassignStatus: reassign.status };
  }

  it('FIRST_LOAD_SCAN: once the driver reached the customer, a reassignment and a cancel return nothing', async () => {
    const { orderId, before, after, reassignStatus } = await arriveThenReassign();
    expect(before.cancel).toEqual({ allowed: true, refundPaisa: '0', noRefundReason: 'DELIVERY_STARTED' });
    expect(reassignStatus).toBe(200);
    const cancel = await f.cancel(orderId, { reasonCode: 'CUSTOMER_CANCELLED' }).expect(200);
    const reversals = await f.ledger({ entryType: 'CREDIT_ORDER_REVERSAL', orderId });
    expect({ termsAfterReassign: after.cancel, refundedPaisa: cancel.body.refundedPaisa, reversalRows: reversals.length }).toEqual({
      termsAfterReassign: { allowed: true, refundPaisa: '0', noRefundReason: 'DELIVERY_STARTED' },
      refundedPaisa: '0',
      reversalRows: 0,
    });
  });

  it('LEFT_STORE: after the same reassignment a cancel returns nothing either', async () => {
    await app.get(SettingsService).set('orders.deliveryStartedAt', 'LEFT_STORE', systemActor('cli:settings'), 'review: refund rule');
    const { orderId, before } = await arriveThenReassign();
    expect(before.cancel.noRefundReason).toBe('DELIVERY_STARTED');
    const cancel = await f.cancel(orderId, { reasonCode: 'CUSTOMER_CANCELLED' }).expect(200);
    expect(cancel.body.refundedPaisa).toBe('0');
  });
});
