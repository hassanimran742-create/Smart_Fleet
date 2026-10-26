/**
 * FEE-023: OrdersFeePolicy's delivery-started and cancel-terms rules, with WalletService mocked.
 */
import type { DeliveryStartedRule } from '@smartfleet/shared-types';
import { systemActor } from '../../src/common/auth/actor';
import { AppError } from '../../src/common/errors/app-error';
import { OrdersFeePolicy, cancelTerms, isDeliveryStarted, type OrderForPolicy } from '../../src/modules/orders/orders-fee.policy';
import type { SettingsService } from '../../src/modules/settings/settings.service';
import type { WalletService } from '../../src/modules/wallet/wallet.service';

const T = new Date('2026-10-22T07:00:00Z');

function order(over: Partial<OrderForPolicy> = {}): OrderForPolicy {
  return {
    id: 'order-1',
    distributorId: 'distributor-da',
    status: 'ASSIGNED',
    feeStatus: 'DEDUCTED',
    feeStrategy: 'DISTRIBUTOR_ZONE',
    deliveryFeePaisa: 25_000n,
    assignedAt: null,
    loadStartedAt: null,
    storeDepartedAt: null,
    deliveryArrivedAt: null,
    handoverStarted: false,
    ...over,
  };
}

const RULES: DeliveryStartedRule[] = ['FIRST_LOAD_SCAN', 'DRIVER_ASSIGNED', 'LEFT_STORE'];

describe('api-orders: OrdersFeePolicy', () => {
  it('FEE-023 isDeliveryStarted follows the rule: loads, the store departure, the delivery arrival, DELIVERED and FAILED', () => {
    const scenarios: Array<[string, Partial<OrderForPolicy>, Record<DeliveryStartedRule, boolean>]> = [
      ['nothing set', {}, { FIRST_LOAD_SCAN: false, DRIVER_ASSIGNED: false, LEFT_STORE: false }],
      ['assignedAt', { assignedAt: T }, { FIRST_LOAD_SCAN: false, DRIVER_ASSIGNED: true, LEFT_STORE: false }],
      ['IN_TRANSIT with onTheWayAt only', { status: 'IN_TRANSIT' }, { FIRST_LOAD_SCAN: false, DRIVER_ASSIGNED: false, LEFT_STORE: false }],
      ['loadStartedAt', { loadStartedAt: T }, { FIRST_LOAD_SCAN: true, DRIVER_ASSIGNED: true, LEFT_STORE: false }],
      ['store stop departedAt', { storeDepartedAt: T }, { FIRST_LOAD_SCAN: true, DRIVER_ASSIGNED: true, LEFT_STORE: true }],
      ['delivery stop arrivedAt', { deliveryArrivedAt: T }, { FIRST_LOAD_SCAN: true, DRIVER_ASSIGNED: true, LEFT_STORE: true }],
      ['status DELIVERED', { status: 'DELIVERED' }, { FIRST_LOAD_SCAN: true, DRIVER_ASSIGNED: true, LEFT_STORE: true }],
      ['status FAILED', { status: 'FAILED' }, { FIRST_LOAD_SCAN: true, DRIVER_ASSIGNED: true, LEFT_STORE: true }],
    ];
    for (const [name, over, expected] of scenarios) {
      for (const rule of RULES) {
        expect({ name, rule, started: isDeliveryStarted(order(over), rule) }).toEqual({ name, rule, started: expected[rule] });
      }
    }
  });

  it('FEE-023 cancelTerms: the refund only for a cost this platform deducted, before the start', () => {
    const rule: DeliveryStartedRule = 'FIRST_LOAD_SCAN';
    expect(cancelTerms(order(), rule)).toEqual({ allowed: true, refundPaisa: 25_000n, noRefundReason: null });
    expect(cancelTerms(order({ loadStartedAt: T }), rule)).toEqual({ allowed: true, refundPaisa: 0n, noRefundReason: 'DELIVERY_STARTED' });
    // Charged by the old code before the switch-over: nothing comes back, and no reason is shown.
    expect(cancelTerms(order({ feeStrategy: 'LEGACY_ZONE_PAIR' }), rule)).toEqual({ allowed: true, refundPaisa: 0n, noRefundReason: null });
    // An order from before the switch-over, or a zero cost.
    expect(cancelTerms(order({ feeStatus: 'NONE', deliveryFeePaisa: 0n, feeStrategy: null }), rule)).toEqual({
      allowed: true,
      refundPaisa: 0n,
      noRefundReason: null,
    });
    // A finished order, or a started hand-over, can't be cancelled.
    for (const status of ['DELIVERED', 'CANCELLED', 'FAILED'] as const) {
      expect({ status, allowed: cancelTerms(order({ status }), rule).allowed }).toEqual({ status, allowed: false });
    }
    expect(cancelTerms(order({ handoverStarted: true }), rule).allowed).toBe(false);
    expect(cancelTerms(order({ handoverStarted: true }), rule).refundPaisa).toBe(0n);
  });

  it('FEE-023 cancel never reverses a NONE or a legacy order, and returns 0 when the wallet has no debit to reverse', async () => {
    const wallet = { reverse: jest.fn(), debit: jest.fn() } as unknown as WalletService & { reverse: jest.Mock };
    const settings = { get: jest.fn(async () => 'FIRST_LOAD_SCAN') } as unknown as SettingsService;
    const policy = new OrdersFeePolicy(wallet, settings);
    const tx = { $executeRaw: jest.fn(async () => 1) } as never;
    const actor = systemActor('test');

    const none = await policy.cancel(tx, order({ feeStatus: 'NONE', deliveryFeePaisa: 0n, feeStrategy: null }), { actor, reasonCode: 'DUPLICATE' });
    expect(none).toEqual({ refunded: false, refundPaisa: 0n, startedRule: 'FIRST_LOAD_SCAN' });
    const legacy = await policy.cancel(tx, order({ feeStrategy: 'LEGACY_ZONE_PAIR' }), { actor, reasonCode: 'WRONG_ORDER' });
    expect(legacy).toEqual({ refunded: false, refundPaisa: 0n, startedRule: 'FIRST_LOAD_SCAN' });
    expect(wallet.reverse).not.toHaveBeenCalled();

    // A refundable order whose debit row is missing: reverse answers null and nothing is returned.
    wallet.reverse.mockResolvedValueOnce(null);
    const missing = await policy.cancel(tx, order(), { actor, reasonCode: 'CUSTOMER_CANCELLED' });
    expect(missing).toEqual({ refunded: false, refundPaisa: 0n, startedRule: 'FIRST_LOAD_SCAN' });
    expect(wallet.reverse).toHaveBeenCalledWith(tx, { subject: { type: 'ORDER', orderId: 'order-1' }, actor, reason: 'CUSTOMER_CANCELLED' });

    // The refund the person saw differs: 409 ORDER_CANCEL_TERMS_CHANGED with today's refund.
    const changed = policy.cancel(tx, order({ loadStartedAt: T }), { actor, reasonCode: 'CUSTOMER_CANCELLED', confirmRefundPaisa: 25_000n });
    await expect(changed).rejects.toBeInstanceOf(AppError);
    await expect(changed).rejects.toMatchObject({ code: 'ORDER_CANCEL_TERMS_CHANGED', details: { refundPaisa: '0' } });
  });

  it('FEE-023 onCreated deducts the quoted cost through WalletService.debit', async () => {
    const wallet = { debit: jest.fn(async () => null), reverse: jest.fn() } as unknown as WalletService & { debit: jest.Mock };
    const policy = new OrdersFeePolicy(wallet, { get: jest.fn() } as unknown as SettingsService);
    const tx = {} as never;
    const actor = systemActor('test');
    await policy.onCreated(tx, { id: 'order-1', distributorId: 'distributor-da' }, { totalPaisa: 25_000n }, actor);
    expect(wallet.debit).toHaveBeenCalledWith(tx, {
      distributorId: 'distributor-da',
      subject: { type: 'ORDER', orderId: 'order-1' },
      amountPaisa: 25_000n,
      actor,
    });
  });
});
