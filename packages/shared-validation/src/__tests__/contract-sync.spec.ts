/**
 * shared-validation depends only on zod, so it repeats the shared-types unions it validates
 * (`internal/codes.ts`). These checks fail when a copy drifts: the type-level ones fail the ts-jest
 * compile, the rest fail at run time.
 */
import { z } from 'zod';
import * as types from '../../../shared-types/src';
import * as codes from '../internal/codes';
import {
  cancelOrderSchema,
  failOrderSchema,
  PROMOTED_ERROR_CODES,
  rejectTopupSchema,
  shareSchema,
  statementQuerySchema,
  topupRequestSchema,
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
      true as Equals<z.output<typeof statementQuerySchema>['kind'], types.StatementKind[] | undefined>,
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
