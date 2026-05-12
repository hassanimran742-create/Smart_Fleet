# RBAC Matrix

Roles: `ADMIN`, `DISPATCHER`, `STORE_KEEPER`, `DISTRIBUTOR`, `DRIVER`, `CLIENT` (future).

Legend: `✓` allowed · `✓*` allowed but scoped to own records · `—` denied

| Resource              | Action            | ADMIN | DISPATCHER | STORE_KEEPER | DISTRIBUTOR | DRIVER | CLIENT |
|---|---|---|---|---|---|---|---|
| users                 | create/list/edit  | ✓ | — | — | — | — | — |
| zones                 | create/edit       | ✓ | — | — | — | — | — |
| zones                 | read              | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| stores                | create/edit       | ✓ | — | — | — | — | — |
| stores                | read              | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| vehicles              | create/edit       | ✓ | ✓ | — | — | — | — |
| drivers               | create/edit       | ✓ | ✓ | — | — | — | — |
| drivers               | read own profile  | ✓ | ✓ | ✓ | — | ✓* | — |
| drivers               | update location   | — | — | — | — | ✓* | — |
| distributors          | create/approve    | ✓ | — | — | — | — | — |
| distributors          | read self         | ✓ | ✓ | ✓ | ✓* | — | — |
| clients               | manage            | ✓ | ✓ | — | ✓* | — | ✓* |
| cylinder_types        | create/edit       | ✓ | — | — | — | — | — |
| cylinders             | scan event        | ✓ | ✓ | ✓ | ✓* | ✓ | — |
| cylinders             | read by serial    | ✓ | ✓ | ✓ | ✓* | ✓ | — |
| custody/audit events  | read              | ✓ | ✓ | ✓ | ✓* | ✓* | — |
| inventory_lots        | read              | ✓ | ✓ | ✓ | ✓* | — | — |
| transfers             | create/approve    | ✓ | ✓ | ✓ | — | — | — |
| pricing_rules         | create/edit       | ✓ | — | — | — | — | — |
| pricing_rules         | read              | ✓ | ✓ | ✓ | ✓ | — | — |
| orders                | create            | ✓ | ✓ | — | ✓* | — | ✓* |
| orders                | read              | ✓ | ✓ | ✓ | ✓* | ✓* (assigned) | ✓* |
| orders                | cancel            | ✓ | ✓ | — | ✓* (pre-assign) | — | — |
| trips                 | create (dispatch) | ✓ | ✓ | — | — | — | — |
| trips                 | start/complete    | — | — | — | — | ✓* | — |
| payments              | initiate top-up   | ✓ | — | — | ✓* | — | — |
| payments              | verify bank proof | ✓ | ✓ | — | — | — | — |
| ledger_entries        | read              | ✓ | ✓ | — | ✓* | — | — |
| reconciliations       | submit            | — | — | — | — | ✓* | — |
| reconciliations       | verify            | ✓ | ✓ | — | — | — | — |
| reports               | read              | ✓ | ✓ | — | ✓* (own) | — | — |
| support_tickets       | create/read       | ✓ | ✓ | ✓ | ✓* | ✓* | ✓* |
| audit_logs            | read              | ✓ | — | — | — | — | — |

## Enforcement
- `@Roles('ADMIN', 'DISPATCHER')` decorator on controller handlers.
- `RolesGuard` reads the metadata and checks `user.role`.
- Tenant scoping: a separate `TenantScopeInterceptor` injects `where: { distributorId: user.distributorId }` on listing endpoints for DISTRIBUTOR role and `where: { driverId: user.driverId }` for DRIVER role. Scoped reads via `prismaService.scoped(req)`.

## Sensitive actions requiring audit_log
Any successful execution of: zone polygon edit, pricing rule write, balance adjustment, refund, role change, user suspension, cylinder mark_lost, bulk operations.
