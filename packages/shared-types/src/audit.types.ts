import type { IsoDateTime, UUID } from './common.types';

/** Mirrors Prisma `AuditActorKind`: a signed-in user, a job or CLI, or a customer on a link (Inc 2). */
export const AuditActorKind = {
  USER: 'USER',
  SYSTEM: 'SYSTEM',
  CUSTOMER: 'CUSTOMER',
} as const;
export type AuditActorKind = (typeof AuditActorKind)[keyof typeof AuditActorKind];

/** Every audit action (API_CONTRACT Appendix B), written in the same transaction as the change. */
export const AUDIT_ACTIONS = [
  // Users and accounts
  'user.status_change',
  'user.role_change',
  'user.password_reset',
  'user.create_office',
  // Distributors and drivers
  'distributor.create',
  'distributor.update',
  'distributor.store_update',
  'distributor.code_change',
  'distributor.activate',
  'distributor.suspend',
  'driver.create',
  'driver.update',
  'driver.archive',
  'driver.reactivate',
  // Settings, zones and prices
  'setting.update',
  'zone.create',
  'zone.update',
  'zone.archive',
  'zone.reactivate',
  'price.set',
  'price.remove',
  // Money
  'topup.request',
  'topup.approve',
  'topup.reject',
  'wallet.correction',
  'wallet.opening_entry',
  'wallet.check',
  // Orders, trips and refills
  'order.create',
  'order.assign',
  'order.reassign',
  'order.cancel',
  'order.fail',
  'order.manual_delivery',
  'trip.abort',
  'refill.create',
  'refill.assign',
  'refill.cancel',
  'refill.complete',
  // Expenses
  'expense.create',
  'expense.update',
  'expense.void',
  'expense_type.create',
  'expense_type.rename',
  'expense_type.archive',
  'expense_type.restore',
  // Customers
  'client.phone_needs_fix',
  'client.update',
  // Cylinders (from Inc 1)
  'cylinders.bulk_register',
  // Inc 2
  'custody.typed_entry',
  'custody.manual_event',
  'confirmation.answer',
  'confirmation.new_link',
  'case.resolve',
  // Inc 3
  'day.submit',
  'day.approve',
  'day.send_back',
  'day.reopen',
  'pilot.setup',
  'pilot.reset',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Actions that must carry a reason (the `*` entries of Appendix B). `distributor.activate` needs one
 * only when it reactivates a SUSPENDED distributor, so the service enforces that case itself.
 */
export const AUDIT_ACTIONS_NEEDING_REASON: readonly AuditAction[] = [
  'user.status_change',
  'user.role_change',
  'distributor.suspend',
  'driver.archive',
  'driver.reactivate',
  'setting.update',
  'price.remove',
  'topup.reject',
  'wallet.correction',
  'order.cancel',
  'order.fail',
  'order.manual_delivery',
  'trip.abort',
  'refill.cancel',
  'expense.void',
  'custody.manual_event',
  'case.resolve',
  'day.send_back',
  'day.reopen',
];

/** Who did it. `label` names system actors (`job:wallet-check`, `cli:settings`, `migration:inc1a`) and links (`link:AG-0142`). */
export interface AuditActorDto {
  kind: AuditActorKind;
  userId?: UUID;
  name?: string;
  label?: string;
}

/** A row of `GET /audit-logs` (office). Unknown actions are shown as their code in words. */
export interface AuditLogDto {
  id: UUID;
  at: IsoDateTime;
  actor: AuditActorDto;
  action: AuditAction | (string & {});
  resourceType: string;
  resourceId: string | null;
  distributorId: UUID | null;
  reason: string | null;
  /** What changed, usually `{ before, after }` or the action's own facts. */
  diff: Record<string, unknown> | null;
}
