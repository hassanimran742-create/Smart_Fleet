/**
 * shared-validation depends only on zod, so it repeats the shared-types unions it validates
 * (`internal/codes.ts`). These checks fail when a copy drifts: the type-level ones fail the ts-jest
 * compile, the rest fail at run time.
 */
import { z } from 'zod';
import * as types from '../../../shared-types/src';
import * as codes from '../internal/codes';
import {
  adminDayEndListQuerySchema,
  cancelOrderSchema,
  casesQuerySchema,
  refillAdvanceSchema,
  refillScanSchema,
  customerAnswerSchema,
  failOrderSchema,
  PROMOTED_ERROR_CODES,
  rejectTopupSchema,
  shareSchema,
  statementQuerySchema,
  topupRequestSchema,
  tripScanSchema,
  VALIDATION_CODES,
  VALIDATION_MESSAGE_EN,
  walletCorrectionSchema,
} from '..';

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('internal codes match shared-types', () => {
  it('repeat the enums in the same order', () => {
    expect(codes.ORDER_STATUSES).toEqual(Object.values(types.OrderStatus));
    expect(codes.TRIP_STATUSES).toEqual(Object.values(types.TripStatus));
    expect(codes.USER_ROLES).toEqual(Object.values(types.UserRole));
    expect(codes.USER_STATUSES).toEqual(Object.values(types.UserStatus));
    expect(codes.PAYER_CHANNELS).toEqual(Object.values(types.PayerChannel));
    expect(codes.STORED_FILE_PURPOSES).toEqual(Object.values(types.StoredFilePurpose));
    expect([...codes.PAYMENT_PROVIDERS, 'CASH'].sort()).toEqual(Object.values(types.PaymentProviderName).sort());
    expect(codes.DRIVER_AVAILABILITIES).toEqual(Object.values(types.DriverAvailability));
    expect(codes.VEHICLE_STATUSES).toEqual(Object.values(types.VehicleStatus));
    expect(codes.ALERT_STATUSES).toEqual(Object.values(types.AlertStatus));
    expect(codes.ALERT_SEVERITIES).toEqual(Object.values(types.AlertSeverity));
    expect(codes.ALERT_RULE_KINDS).toEqual(Object.values(types.AlertRuleKind));
    expect(codes.TICKET_STATUSES).toEqual(Object.values(types.TicketStatus));
  });

  it('repeat the unions in the same order', () => {
    expect(codes.ORDER_CANCEL_REASONS).toEqual(types.ORDER_CANCEL_REASONS);
    expect(codes.DELIVERY_FAILURE_REASONS).toEqual(types.DELIVERY_FAILURE_REASONS);
    expect(codes.TOPUP_REJECT_REASONS).toEqual(types.TOPUP_REJECT_REASONS);
    expect(codes.CORRECTION_REASONS).toEqual(types.CORRECTION_REASONS);
    expect(codes.CORRECTION_DIRECTIONS).toEqual(types.CORRECTION_DIRECTIONS);
    expect(codes.STATEMENT_KINDS).toEqual(types.STATEMENT_KINDS);
    expect(codes.ORDER_LIST_TABS).toEqual(types.ORDER_LIST_TABS);
    expect(codes.ORDER_BOARD_TABS).toEqual(types.ORDER_BOARD_TABS);
    expect(codes.ADMIN_TOPUP_TABS).toEqual(types.ADMIN_TOPUP_TABS);
    expect(codes.TAKE_BACK_SHORT_REASONS).toEqual(types.TAKE_BACK_SHORT_REASONS);
    expect(codes.CONFIRMATION_SHARE_VIAS).toEqual(types.CONFIRMATION_SHARE_VIAS);
    expect(codes.CONFIRMATION_RESPONSES).toEqual(types.CONFIRMATION_RESPONSES);
    expect(codes.CONFIRMATION_RESPONSES).toEqual(Object.values(types.ConfirmationResponse));
    expect(codes.CASE_STATUSES).toEqual(types.CASE_STATUSES);
    expect(codes.SCAN_ENTRY_METHODS).toEqual(types.SCAN_ENTRY_METHODS);
    expect(codes.DRIVER_SCAN_ACTIONS).toEqual(types.DRIVER_SCAN_ACTIONS);
    for (const action of codes.DRIVER_SCAN_ACTIONS) expect(types.SCAN_ACTIONS).toContain(action);
    // Inc 3
    expect(codes.REFILL_SCAN_PHASES).toEqual(types.REFILL_SCAN_PHASES);
    expect(codes.REFILL_ADVANCE_TARGETS).toEqual(types.REFILL_ADVANCE_TARGETS);
    expect(codes.DAY_CLOSE_STATUSES).toEqual(Object.values(types.DayCloseStatus));
    const returnStates: true = true as Equals<(typeof codes.RETURN_STATES)[number], types.ReturnState>;
    expect(returnStates).toBe(true);
  });

  it('infer the shared-types unions from the schemas', () => {
    const checks: true[] = [
      true as Equals<z.infer<typeof cancelOrderSchema>['reasonCode'], types.OrderCancelReason>,
      true as Equals<z.infer<typeof failOrderSchema>['reasonCode'], types.DeliveryFailureReason>,
      true as Equals<z.infer<typeof rejectTopupSchema>['reasonCode'], types.TopupRejectReason>,
      true as Equals<z.infer<typeof walletCorrectionSchema>['reasonCode'], types.CorrectionReason>,
      true as Equals<z.infer<typeof walletCorrectionSchema>['direction'], types.CorrectionDirection>,
      true as Equals<z.infer<typeof topupRequestSchema>['payerChannel'], types.PayerChannel>,
      true as Equals<z.infer<typeof shareSchema>['via'], types.ConfirmationShareVia>,
      true as Equals<z.infer<typeof customerAnswerSchema>['answer'], types.ConfirmationResponse>,
      true as Equals<z.output<typeof casesQuerySchema>['status'], types.CaseStatus>,
      true as Equals<z.infer<typeof tripScanSchema>['action'], types.DriverScanAction>,
      true as Equals<z.infer<typeof tripScanSchema>['entryMethod'], types.ScanEntryMethod>,
      true as Equals<NonNullable<z.infer<typeof tripScanSchema>['returnState']>, types.ReturnState>,
      true as Equals<z.output<typeof statementQuerySchema>['kind'], types.StatementKind[] | undefined>,
      // Inc 3
      true as Equals<z.infer<typeof refillScanSchema>['phase'], types.RefillScanPhase>,
      true as Equals<z.infer<typeof refillScanSchema>['entryMethod'], types.ScanEntryMethod>,
      true as Equals<z.infer<typeof refillAdvanceSchema>['to'], types.RefillAdvanceTarget>,
      true as Equals<NonNullable<z.output<typeof adminDayEndListQuerySchema>['status']>, types.DayCloseStatus>,
    ];
    expect(checks.every(Boolean)).toBe(true);
  });
});

describe('promoted validation codes', () => {
  it('are catalogue error codes with the same English', () => {
    for (const code of PROMOTED_ERROR_CODES) {
      expect(types.isErrorCode(code)).toBe(true);
      expect(VALIDATION_MESSAGE_EN[code]).toBe(types.ERROR_MESSAGE_EN[code as types.ErrorCode]);
      expect(types.ERROR_HTTP[code as types.ErrorCode]).toBeGreaterThanOrEqual(400);
    }
  });

  it('are the only validation codes that are also error codes', () => {
    const shared = VALIDATION_CODES.filter((code) => types.isErrorCode(code));
    expect([...shared].sort()).toEqual([...PROMOTED_ERROR_CODES].sort());
  });
});
