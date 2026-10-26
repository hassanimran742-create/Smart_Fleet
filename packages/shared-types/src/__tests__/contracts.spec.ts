import {
  AUDIT_ACTIONS,
  AUDIT_ACTIONS_NEEDING_REASON,
  CASE_STATUSES,
  DAY_CLOSE_FIXES,
  DAY_END_ROW_ERROR_CODES,
  DAY_END_ROW_ERROR_EN,
  DAY_END_STAGES,
  DAY_SHEET_ABOUT_KEYS,
  DAY_SHEET_CYLINDER_HEADERS,
  DAY_SHEET_EXTRA_HEADERS,
  DAY_SHEET_PLACE_WORDS,
  DAY_SHEET_STATE_WORDS,
  DayClosePlace,
  ERROR_MESSAGE_EN,
  FillingOrderCylinderStatus,
  OPEN_REFILL_LINE_STATUSES,
  REFILL_ADVANCE_TARGETS,
  REFILL_SCAN_PHASES,
  CONFIRMATION_RESPONSES,
  CONFIRMATION_SHARE_VIAS,
  ConfirmationResponse,
  CORRECTION_REASONS,
  DRIVER_SCAN_ACTIONS,
  MESSAGE_FAIL_CODES,
  MESSAGE_SKIP_REASONS,
  SCAN_ACTIONS,
  SCAN_ENTRY_METHODS,
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
      // Inc 2
      SCAN_ACTIONS,
      DRIVER_SCAN_ACTIONS,
      SCAN_ENTRY_METHODS,
      CONFIRMATION_RESPONSES,
      CONFIRMATION_SHARE_VIAS,
      CASE_STATUSES,
      MESSAGE_SKIP_REASONS,
      MESSAGE_FAIL_CODES,
      // Inc 3
      DAY_END_STAGES,
      DAY_CLOSE_FIXES,
      DAY_END_ROW_ERROR_CODES,
      DAY_SHEET_ABOUT_KEYS,
      DAY_SHEET_CYLINDER_HEADERS,
      DAY_SHEET_EXTRA_HEADERS,
      REFILL_SCAN_PHASES,
      REFILL_ADVANCE_TARGETS,
    ]) {
      expect(new Set<string>(list).size).toBe(list.length);
    }
  });

  it('[Inc 3] keep the sheet words one per place and state, the open refill lines before RETURNED, and the row errors short', () => {
    expect(Object.keys(DAY_SHEET_PLACE_WORDS).sort()).toEqual(Object.values(DayClosePlace).sort());
    expect(new Set(Object.values(DAY_SHEET_PLACE_WORDS)).size).toBe(4);
    expect(Object.keys(DAY_SHEET_STATE_WORDS)).toEqual(['FULL', 'EMPTY', 'PART_FILLED', 'FAULTY']);
    expect(OPEN_REFILL_LINE_STATUSES).toEqual(Object.values(FillingOrderCylinderStatus).filter((status) => status !== 'RETURNED'));
    expect(Object.keys(DAY_END_ROW_ERROR_EN)).toEqual([...DAY_END_ROW_ERROR_CODES]);
    // The extra-sheet header and the cylinder sheet's first two read the same, so a number column is one rule.
    expect(DAY_SHEET_EXTRA_HEADERS.slice(0, 2)).toEqual(DAY_SHEET_CYLINDER_HEADERS.slice(0, 2));
    expect(ERROR_MESSAGE_EN.DAY_SHEET_ROW_ERRORS).toBe("Some rows couldn't be read. Fix them and upload again.");
  });

  it('[Inc 2] keep the driver scan actions among the scan actions, and the answers in the page order', () => {
    for (const action of DRIVER_SCAN_ACTIONS) expect(SCAN_ACTIONS).toContain(action);
    expect(CONFIRMATION_RESPONSES).toEqual(Object.values(ConfirmationResponse));
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
