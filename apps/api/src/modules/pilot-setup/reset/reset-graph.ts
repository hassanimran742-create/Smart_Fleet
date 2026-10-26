/**
 * What the pilot reset deletes and what makes it refuse (API_CONTRACT §10.3, settled point G10-02), as
 * data. The plan starts from every `is_test` distributor, user and van and adds what hangs off them; a
 * row that stays may never point at a row the plan deletes. A DB test keeps every foreign key of the
 * schema listed here (reset-graph coverage), so a new table can't slip past the reset.
 */

/** The office's roles: their users are never deleted, even when marked `is_test` by hand. */
export const OFFICE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'DISPATCHER'] as const;

/** A cylinder's or a lot's holder is a store, a van or a customer. */
export const HOLDER_TABLES = ['stores', 'vehicles', 'clients'] as const;

/** Any deleted row, whatever its table (`resource_id` columns). */
export const ANY_TABLE = '*';

/** `table.column` names a row of one of `parents`: when that row goes, this one goes too. */
export interface OwnedBy {
  table: string;
  column: string;
  parents: readonly string[];
}

/** `table.column` names a row of one of `targets`: a row that stays may not point at a deleted one. */
export interface PointsAt {
  table: string;
  column: string;
  targets: readonly string[];
}

/**
 * Rows a test row owns (by `distributor_id`, `driver_id`, `user_id` or `vehicle_id`) and the rows under
 * those (§10.3): customers and addresses, orders and their lines, trips and stops, stop rows, payments,
 * ledger rows, cylinders and their events, refills and their lines, confirmations and messages, day-end
 * rows, prices, stored files, push tokens, the vans' and drivers' expenses, fuel and shifts.
 * Applied until nothing more is added.
 */
export const OWNED_BY: readonly OwnedBy[] = [
  // An account and its profile go together (the profile's row names the user).
  { table: 'distributors', column: 'user_id', parents: ['users'] },
  { table: 'drivers', column: 'user_id', parents: ['users'] },
  // A shop's rows.
  { table: 'clients', column: 'distributor_id', parents: ['distributors'] },
  { table: 'client_addresses', column: 'client_id', parents: ['clients'] },
  { table: 'orders', column: 'distributor_id', parents: ['distributors'] },
  { table: 'orders', column: 'client_id', parents: ['clients'] },
  { table: 'order_lines', column: 'order_id', parents: ['orders'] },
  { table: 'delivery_confirmations', column: 'order_id', parents: ['orders'] },
  { table: 'delivery_confirmations', column: 'distributor_id', parents: ['distributors'] },
  { table: 'outbound_messages', column: 'confirmation_id', parents: ['delivery_confirmations'] },
  { table: 'outbound_messages', column: 'order_id', parents: ['orders'] },
  { table: 'outbound_messages', column: 'distributor_id', parents: ['distributors'] },
  { table: 'payments', column: 'distributor_id', parents: ['distributors'] },
  { table: 'ledger_entries', column: 'distributor_id', parents: ['distributors'] },
  { table: 'cylinders', column: 'distributor_id', parents: ['distributors'] },
  { table: 'cylinder_events', column: 'cylinder_id', parents: ['cylinders'] },
  { table: 'filling_orders', column: 'distributor_id', parents: ['distributors'] },
  { table: 'filling_order_cylinders', column: 'filling_order_id', parents: ['filling_orders'] },
  { table: 'filling_order_cylinders', column: 'cylinder_id', parents: ['cylinders'] },
  { table: 'day_closes', column: 'distributor_id', parents: ['distributors'] },
  { table: 'day_close_lines', column: 'day_close_id', parents: ['day_closes'] },
  { table: 'day_close_lines', column: 'cylinder_id', parents: ['cylinders'] },
  { table: 'distributor_zone_prices', column: 'distributor_id', parents: ['distributors'] },
  { table: 'stored_files', column: 'distributor_id', parents: ['distributors'] },
  { table: 'stored_files', column: 'uploaded_by_user_id', parents: ['users'] },
  { table: 'alerts', column: 'distributor_id', parents: ['distributors'] },
  { table: 'inventory_lots', column: 'distributor_id', parents: ['distributors'] },
  { table: 'inventory_lots', column: 'holder_id', parents: HOLDER_TABLES },
  { table: 'accessory_stock', column: 'store_id', parents: ['stores'] },
  { table: 'accessory_movements', column: 'store_id', parents: ['stores'] },
  // Runs: a test driver's or a test van's.
  { table: 'trips', column: 'driver_id', parents: ['drivers'] },
  { table: 'trips', column: 'vehicle_id', parents: ['vehicles'] },
  { table: 'trip_stops', column: 'trip_id', parents: ['trips'] },
  { table: 'trip_stops', column: 'order_id', parents: ['orders'] },
  { table: 'stop_cylinders', column: 'trip_stop_id', parents: ['trip_stops'] },
  { table: 'stop_cylinders', column: 'order_id', parents: ['orders'] },
  { table: 'stop_cylinders', column: 'cylinder_id', parents: ['cylinders'] },
  { table: 'stop_unlabelled_returns', column: 'trip_stop_id', parents: ['trip_stops'] },
  { table: 'stop_unlabelled_returns', column: 'order_id', parents: ['orders'] },
  { table: 'driver_shifts', column: 'driver_id', parents: ['drivers'] },
  { table: 'fuel_refills', column: 'driver_id', parents: ['drivers'] },
  { table: 'fuel_refills', column: 'vehicle_id', parents: ['vehicles'] },
  { table: 'reconciliations', column: 'driver_id', parents: ['drivers'] },
  { table: 'expenses', column: 'driver_id', parents: ['drivers'] },
  { table: 'expenses', column: 'vehicle_id', parents: ['vehicles'] },
  { table: 'transfers', column: 'driver_id', parents: ['drivers'] },
  { table: 'transfers', column: 'vehicle_id', parents: ['vehicles'] },
  { table: 'transfers', column: 'from_store_id', parents: ['stores'] },
  { table: 'transfers', column: 'to_store_id', parents: ['stores'] },
  { table: 'transfer_lines', column: 'transfer_id', parents: ['transfers'] },
  { table: 'transfer_lines', column: 'cylinder_id', parents: ['cylinders'] },
  // A test login's own rows.
  { table: 'refresh_tokens', column: 'user_id', parents: ['users'] },
  { table: 'expo_push_tokens', column: 'user_id', parents: ['users'] },
  { table: 'support_tickets', column: 'reporter_user_id', parents: ['users'] },
];

/**
 * Rows about a deleted row, added once the plan above is complete: alerts and rules about it, support
 * tickets on it, and the audit rows whose actor, `distributor_id` or `resource_id` is a deleted row (the
 * one exception to the append-only log: `audit_logs.actor_user_id` is a RESTRICT foreign key). Audit rows
 * come last, so the rows about a deleted alert go too.
 */
export const ABOUT_DELETED: readonly OwnedBy[] = [
  { table: 'alerts', column: 'resource_id', parents: [ANY_TABLE] },
  { table: 'alert_rules', column: 'resource_id', parents: [ANY_TABLE] },
  { table: 'support_tickets', column: 'subject_id', parents: [ANY_TABLE] },
  { table: 'audit_logs', column: 'actor_user_id', parents: ['users'] },
  { table: 'audit_logs', column: 'distributor_id', parents: ['distributors'] },
  { table: 'audit_logs', column: 'resource_id', parents: [ANY_TABLE] },
];

/**
 * A row that stays and points at a row the plan deletes: the reset refuses and names the first one
 * (in this order: a live order on a test run says the most). Actor columns that point at office users
 * keep nothing: office users are never deleted.
 */
export const POINTS_AT: readonly PointsAt[] = [
  { table: 'orders', column: 'trip_id', targets: ['trips'] },
  { table: 'orders', column: 'delivered_by_user_id', targets: ['users'] },
  { table: 'orders', column: 'cancelled_by_user_id', targets: ['users'] },
  { table: 'orders', column: 'origin_store_id', targets: ['stores'] },
  { table: 'trips', column: 'origin_store_id', targets: ['stores'] },
  { table: 'trip_stops', column: 'store_id', targets: ['stores'] },
  { table: 'cylinders', column: 'custody_id', targets: HOLDER_TABLES },
  { table: 'cylinders', column: 'last_event_id', targets: ['cylinder_events'] },
  { table: 'cylinder_events', column: 'actor_user_id', targets: ['users'] },
  { table: 'cylinder_events', column: 'trip_id', targets: ['trips'] },
  { table: 'cylinder_events', column: 'trip_stop_id', targets: ['trip_stops'] },
  { table: 'cylinder_events', column: 'order_id', targets: ['orders'] },
  { table: 'cylinder_events', column: 'filling_order_id', targets: ['filling_orders'] },
  { table: 'cylinder_events', column: 'transfer_id', targets: ['transfers'] },
  { table: 'cylinder_events', column: 'from_custody_id', targets: HOLDER_TABLES },
  { table: 'cylinder_events', column: 'to_custody_id', targets: HOLDER_TABLES },
  { table: 'stop_cylinders', column: 'event_id', targets: ['cylinder_events'] },
  { table: 'stop_unlabelled_returns', column: 'recorded_by_user_id', targets: ['users'] },
  { table: 'filling_orders', column: 'assigned_driver_id', targets: ['drivers'] },
  { table: 'filling_orders', column: 'assigned_vehicle_id', targets: ['vehicles'] },
  { table: 'filling_orders', column: 'pickup_store_id', targets: ['stores'] },
  { table: 'filling_orders', column: 'cancelled_by_user_id', targets: ['users'] },
  { table: 'ledger_entries', column: 'order_id', targets: ['orders'] },
  { table: 'ledger_entries', column: 'payment_id', targets: ['payments'] },
  { table: 'ledger_entries', column: 'filling_order_id', targets: ['filling_orders'] },
  { table: 'ledger_entries', column: 'created_by_user_id', targets: ['users'] },
  { table: 'payments', column: 'proof_file_id', targets: ['stored_files'] },
  { table: 'payments', column: 'verified_by_user_id', targets: ['users'] },
  { table: 'clients', column: 'user_id', targets: ['users'] },
  { table: 'drivers', column: 'current_vehicle_id', targets: ['vehicles'] },
  { table: 'distributors', column: 'home_store_id', targets: ['stores'] },
  { table: 'day_closes', column: 'sheet_file_id', targets: ['stored_files'] },
  { table: 'day_closes', column: 'upload_file_id', targets: ['stored_files'] },
  { table: 'day_closes', column: 'uploaded_by_user_id', targets: ['users'] },
  { table: 'day_closes', column: 'approved_by_user_id', targets: ['users'] },
  { table: 'day_close_lines', column: 'applied_event_id', targets: ['cylinder_events'] },
  { table: 'expenses', column: 'receipt_file_id', targets: ['stored_files'] },
  { table: 'expenses', column: 'recorded_by_user_id', targets: ['users'] },
  { table: 'expenses', column: 'voided_by_user_id', targets: ['users'] },
  { table: 'outbound_messages', column: 'created_by_user_id', targets: ['users'] },
  { table: 'distributor_zone_prices', column: 'updated_by_user_id', targets: ['users'] },
  { table: 'alerts', column: 'resolved_by_user_id', targets: ['users'] },
  { table: 'transfers', column: 'requested_by', targets: ['users'] },
  { table: 'accessory_movements', column: 'actor_user_id', targets: ['users'] },
  { table: 'support_tickets', column: 'assignee_user_id', targets: ['users'] },
  { table: 'reconciliations', column: 'verified_by_user_id', targets: ['users'] },
  { table: 'expense_types', column: 'created_by_user_id', targets: ['users'] },
  { table: 'alert_rules', column: 'created_by', targets: ['users'] },
  { table: 'app_settings', column: 'updated_by_user_id', targets: ['users'] },
];

/** Tables whose rows the reset never deletes (shared set-up the next run reuses). */
export const NEVER_DELETED = [
  'accessories',
  'app_settings',
  'cities',
  'cylinder_types',
  'expense_types',
  'filling_stations',
  'otp_codes',
  'pricing_rules',
  'zones',
] as const;

/** Tables without an `id` column, named by another expression in a refusal. */
export const ROW_NAME_EXPRESSION: Readonly<Record<string, string>> = {
  app_settings: `t.key || ' (' || t.scope || ')'`,
};

/**
 * The order rows are deleted in, children first, so no foreign key is ever broken: every table the plan
 * can add rows to appears exactly once.
 */
export const DELETE_ORDER = [
  'audit_logs',
  'alerts',
  'alert_rules',
  'support_tickets',
  'outbound_messages',
  'delivery_confirmations',
  'day_close_lines',
  'day_closes',
  'stop_cylinders',
  'stop_unlabelled_returns',
  'filling_order_cylinders',
  'transfer_lines',
  'ledger_entries',
  'cylinder_events',
  'trip_stops',
  'order_lines',
  'orders',
  'trips',
  'filling_orders',
  'cylinders',
  'inventory_lots',
  'transfers',
  'payments',
  'expenses',
  'fuel_refills',
  'driver_shifts',
  'reconciliations',
  'stored_files',
  'client_addresses',
  'clients',
  'distributor_zone_prices',
  'refresh_tokens',
  'expo_push_tokens',
  'accessory_movements',
  'accessory_stock',
  'drivers',
  'distributors',
  'stores',
  'vehicles',
  'users',
] as const;
export type ResetTable = (typeof DELETE_ORDER)[number];
