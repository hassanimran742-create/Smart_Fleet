/**
 * Mirrors of the Prisma alert enums (schema.prisma), for the legacy `/alerts` and `/alert-rules`
 * routes (API_CONTRACT §7.2) and the Inc 2 cases. The API's prisma-enum-mirrors spec fails if a copy
 * drifts from the schema.
 */

/** Mirrors Prisma `AlertSeverity`. */
export const AlertSeverity = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
} as const;
export type AlertSeverity = (typeof AlertSeverity)[keyof typeof AlertSeverity];

/** Mirrors Prisma `AlertStatus`. */
export const AlertStatus = {
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESOLVED: 'RESOLVED',
} as const;
export type AlertStatus = (typeof AlertStatus)[keyof typeof AlertStatus];

/**
 * Mirrors Prisma `AlertType`. `WALLET_CHECK_MISMATCH` is raised by the nightly wallet check (§8.5).
 * [Inc 2] `CUSTOMER_PROBLEM` is a case opened by a confirmation answer (context
 * `CustomerProblemContext`); `VAN_NOT_EMPTY` is one unresolved alert per van holding cylinders at the
 * cut-off or after a finish with leftovers (context {@link VanNotEmptyContext}).
 */
export const AlertType = {
  DISPATCH_NO_CANDIDATE: 'DISPATCH_NO_CANDIDATE',
  LOW_STOCK: 'LOW_STOCK',
  ORDER_STUCK_PENDING: 'ORDER_STUCK_PENDING',
  DRIVER_OFFLINE_WHILE_ON_TRIP: 'DRIVER_OFFLINE_WHILE_ON_TRIP',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  RECONCILIATION_MISMATCH: 'RECONCILIATION_MISMATCH',
  CYLINDER_LOST: 'CYLINDER_LOST',
  DISTRIBUTOR_BALANCE_LOW: 'DISTRIBUTOR_BALANCE_LOW',
  DISTRIBUTOR_CREDIT_OVER: 'DISTRIBUTOR_CREDIT_OVER',
  STORE_STOCK_LOW: 'STORE_STOCK_LOW',
  SPECIAL_CLIENT: 'SPECIAL_CLIENT',
  OTHER: 'OTHER',
  WALLET_CHECK_MISMATCH: 'WALLET_CHECK_MISMATCH',
  CUSTOMER_PROBLEM: 'CUSTOMER_PROBLEM',
  VAN_NOT_EMPTY: 'VAN_NOT_EMPTY',
} as const;
export type AlertType = (typeof AlertType)[keyof typeof AlertType];

/** [Inc 2] The `context` of a VAN_NOT_EMPTY alert (API_CONTRACT §9.9); a new raise only updates it. */
export interface VanNotEmptyContext {
  vehicleId: string;
  plateNo: string;
  count: number;
  tripId: string | null;
  leftoverReason: string | null;
}

/**
 * Mirrors Prisma `AlertRuleKind`. `DISTRIBUTOR_CREDIT_OVER` is retired: balances can't go negative
 * (ADR-06), so such a rule can't be created or set active, and inc1a switched the old ones off.
 */
export const AlertRuleKind = {
  DISTRIBUTOR_BALANCE_LOW: 'DISTRIBUTOR_BALANCE_LOW',
  DISTRIBUTOR_CREDIT_OVER: 'DISTRIBUTOR_CREDIT_OVER',
  STORE_STOCK_LOW: 'STORE_STOCK_LOW',
  SPECIAL_CLIENT: 'SPECIAL_CLIENT',
} as const;
export type AlertRuleKind = (typeof AlertRuleKind)[keyof typeof AlertRuleKind];
