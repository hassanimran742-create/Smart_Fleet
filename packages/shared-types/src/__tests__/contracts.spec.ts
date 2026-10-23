import {
  AUDIT_ACTIONS,
  AUDIT_ACTIONS_NEEDING_REASON,
  CORRECTION_REASONS,
  DELIVERY_FAILURE_REASONS,
  ORDER_CANCEL_REASONS,
  ORDER_STAGES,
  SETTING_KEYS,
  STATEMENT_KINDS,
  TAKE_BACK_SHORT_REASONS,
  TOPUP_REJECT_REASONS,
  type SettingKey,
  type SettingValueMap,
} from '..';

describe('shared unions', () => {
  it('list each value once', () => {
    for (const list of [
      ORDER_STAGES,
      STATEMENT_KINDS,
      ORDER_CANCEL_REASONS,
      DELIVERY_FAILURE_REASONS,
      TOPUP_REJECT_REASONS,
      CORRECTION_REASONS,
      TAKE_BACK_SHORT_REASONS,
      AUDIT_ACTIONS,
      SETTING_KEYS,
    ]) {
      expect(new Set<string>(list).size).toBe(list.length);
    }
  });

  it('end every reason list with OTHER, which needs a note', () => {
    for (const list of [
      ORDER_CANCEL_REASONS,
      DELIVERY_FAILURE_REASONS,
      TOPUP_REJECT_REASONS,
      CORRECTION_REASONS,
      TAKE_BACK_SHORT_REASONS,
    ]) {
      expect(list[list.length - 1]).toBe('OTHER');
    }
  });

  it('require a reason only on known audit actions', () => {
    for (const action of AUDIT_ACTIONS_NEEDING_REASON) expect(AUDIT_ACTIONS).toContain(action);
  });
});

describe('settings', () => {
  it('names settings as dotted camelCase paths', () => {
    for (const key of SETTING_KEYS) expect(key).toMatch(/^[a-z][A-Za-z]*(\.[a-z][A-Za-z0-9]*)+$/);
  });

  it('types every key', () => {
    // A compile-time check: indexing the value map with every key must type-check.
    const sample: { [K in SettingKey]?: SettingValueMap[K] } = {
      'orders.deliveryStartedAt': 'FIRST_LOAD_SCAN',
      'topup.onAmountMismatch': 'CREDIT_BANK_AMOUNT',
      'wallet.maxBalancePaisa': null,
      'auth.lockedRoles': ['ADMIN', 'DISPATCHER', 'STORE_KEEPER', 'CLIENT'],
    };
    expect(Object.keys(sample).every((key) => (SETTING_KEYS as readonly string[]).includes(key))).toBe(true);
  });
});
