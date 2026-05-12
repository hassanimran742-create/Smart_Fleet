# Database Schema (ERD)

PostgreSQL 16 + PostGIS 3.4. Prisma migrations in `apps/api/prisma/`. Spatial columns use `geometry(...)` from PostGIS; Prisma sees them as `Unsupported("geometry(Point,4326)")` and queries hit them via `$queryRaw`.

## Entity overview

```
User ─┬─< StaffProfile       (role=ADMIN | DISPATCHER | STORE_KEEPER)
      ├─< DistributorProfile (1:1)
      └─< DriverProfile      (1:1)

Distributor ─< Client (end customer of the distributor)
Distributor ─< Cylinder (every physical cylinder is owned by exactly one distributor)
Distributor ─< LedgerEntry / Payment

City ─< Zone (polygon, PostGIS)
Zone ─< Store
Zone ─< Vehicle (assigned-zone, may be reassigned)

Vehicle 1─1 (current) Driver
Vehicle ─< Trip
Driver  ─< Trip

Store ─< InventoryLot   (storeId × distributorId × cylinderTypeId × state)
Vehicle ─< InventoryLot (vehicleId × distributorId × cylinderTypeId × state)

CylinderType (e.g. LPG-11kg, LPG-45kg)
Cylinder (serial, qrCode, distributorId, cylinderTypeId, currentCustodyType, currentCustodyId, state)
CylinderEvent (append-only custody log)

Order ─< OrderLine        (cylinderTypeId, fullCount, expectedReturnCount)
Order  >─ Trip (many orders per trip)
Trip ─< TripStop (ordered)

Transfer (store→store cylinder rebalancing)
PricingRule (originZoneId × destZoneId × cylinderTypeId)
Payment ─ LedgerEntry (debit/credit)
Reconciliation (driver end-of-day)
SupportTicket
AuditLog
```

## Key tables

### users
- `id uuid PK`
- `phone E.164 UNIQUE`
- `email NULL`
- `name`
- `role enum(ADMIN, DISPATCHER, STORE_KEEPER, DISTRIBUTOR, DRIVER, CLIENT)`
- `status enum(PENDING, ACTIVE, SUSPENDED)`
- `cnic_encrypted bytea NULL` (PK national ID, AES-GCM, with blind index column)
- `cnic_index char(64)` (HMAC-SHA256 blind index for searchability)
- `created_at, updated_at`

### otp_codes
- `id uuid PK`
- `phone`
- `code_hash` (never store plaintext OTPs)
- `purpose enum(LOGIN, RESET)`
- `expires_at`
- `consumed_at`
- `attempts int`
- Rate-limit lookups: `(phone, created_at)` index

### refresh_tokens
- `id uuid PK`
- `user_id FK`
- `token_hash`
- `parent_id` (rotation chain — reuse detection)
- `revoked_at`
- `expires_at`

### distributors
- `id uuid PK`
- `user_id FK users` (the login account)
- `business_name`
- `home_store_id FK stores` (nearest by default)
- `advance_balance_paisa bigint` (denormalized; source of truth is ledger sum)
- `status`

### clients
- `id uuid PK`
- `distributor_id FK`
- `name, phone`
- `addresses` (1:M to client_addresses with `location geometry(Point,4326)`)

### drivers
- `id uuid PK`
- `user_id FK users`
- `licence_no`
- `current_vehicle_id FK vehicles NULL`
- `current_zone_id FK zones NULL` (derived from live location)
- `current_location geometry(Point,4326) NULL`
- `current_location_updated_at`
- `is_online bool`

### vehicles
- `id uuid PK`
- `plate_no UNIQUE`
- `capacity_cylinders int` (max simultaneous cylinders by 11kg-equivalents)
- `home_zone_id FK zones`
- `current_driver_id FK drivers NULL`
- `status enum(ACTIVE, MAINTENANCE, RETIRED)`

### cities
- `id uuid PK`, `name`, `country_code`, `bounds geometry(Polygon,4326)`

### zones
- `id uuid PK`
- `city_id FK`
- `name` (e.g. "DHA Phase 5")
- `polygon geometry(MultiPolygon,4326) NOT NULL` — GIST indexed
- `centroid geometry(Point,4326)`
- `is_active bool`

### stores
- `id uuid PK`
- `name`
- `zone_id FK`
- `address`
- `location geometry(Point,4326)` — GIST indexed
- `is_active bool`

### cylinder_types
- `id uuid PK`
- `code` (e.g. `LPG_11KG`, `LPG_45KG`, future `WATER_19L`)
- `name`
- `weight_kg numeric`
- `capacity_units int` (1 for 11kg, 4 for 45kg — used by vehicle capacity math)

### cylinders
- `id uuid PK`
- `serial UNIQUE`
- `qr_code UNIQUE`
- `distributor_id FK` (owner)
- `cylinder_type_id FK`
- `state enum(FULL, EMPTY, FAULTY, LOST)`
- `custody_type enum(DISTRIBUTOR, STORE, VEHICLE, CLIENT)`
- `custody_id uuid` (polymorphic — references one of distributors/stores/vehicles/clients depending on type; enforced by application + check constraint)
- `last_event_id FK cylinder_events`
- `created_at, updated_at`

### cylinder_events  (append-only chain-of-custody log)
- `id uuid PK`
- `cylinder_id FK`
- `event_type enum(SCAN_IN, SCAN_OUT, DELIVERED, PICKED_UP_EMPTY, RETURNED_TO_DISTRIBUTOR, TRANSFER, MARK_FAULTY, MARK_LOST)`
- `from_custody_type, from_custody_id`
- `to_custody_type, to_custody_id`
- `actor_user_id FK users` (the scanner)
- `photo_url NULL`
- `location geometry(Point,4326) NULL`
- `trip_id FK NULL`
- `order_id FK NULL`
- `transfer_id FK NULL`
- `created_at`

### inventory_lots  (aggregated for fast queries; cylinders table is source of truth)
- `id uuid PK`
- `holder_type enum(STORE, VEHICLE, DISTRIBUTOR)`
- `holder_id uuid`
- `distributor_id FK`
- `cylinder_type_id FK`
- `state enum(FULL, EMPTY)`
- `count int`
- UNIQUE (holder_type, holder_id, distributor_id, cylinder_type_id, state)

> Recompute via trigger on cylinder_events OR via background job; v1 = trigger.

### transfers
- `id uuid PK`
- `from_store_id FK stores`
- `to_store_id FK stores`
- `vehicle_id FK NULL`
- `status enum(REQUESTED, IN_TRANSIT, COMPLETED, CANCELLED)`
- `requested_by FK users`
- `created_at, completed_at`

### transfer_lines
- `transfer_id FK`
- `cylinder_id FK` (per-cylinder serial because cylinders are tracked individually)

### orders
- `id uuid PK`
- `distributor_id FK`
- `client_id FK clients`
- `delivery_address geometry(Point,4326)`
- `delivery_address_label text`
- `dest_zone_id FK zones` (resolved at order creation)
- `origin_store_id FK stores NULL` (resolved at dispatch — distributor's nearest store)
- `status enum(PENDING, CONFIRMED, ASSIGNED, IN_TRANSIT, DELIVERED, CANCELLED, FAILED)`
- `payment_status enum(UNPAID, PAID_VIA_LEDGER, PAID_DIRECT)`
- `delivery_fee_paisa bigint`
- `scheduled_window_start, scheduled_window_end` (NULL = ASAP)
- `created_at, updated_at`

### order_lines
- `order_id FK`
- `cylinder_type_id FK`
- `full_count int`
- `expected_return_count int`

### trips
- `id uuid PK`
- `driver_id FK`
- `vehicle_id FK`
- `origin_store_id FK`
- `status enum(PLANNED, IN_PROGRESS, COMPLETED, ABORTED)`
- `planned_at, started_at, completed_at`

### trip_stops
- `id uuid PK`
- `trip_id FK`
- `order_id FK NULL` (NULL means store-stop: pickup/restock or empty drop-off)
- `seq int` (visit order)
- `stop_type enum(STORE_PICKUP, DELIVERY, RETURN_DROPOFF)`
- `location geometry(Point,4326)`
- `eta_at, arrived_at, departed_at`
- `notes`

### pricing_rules
- `id uuid PK`
- `city_id FK`
- `origin_zone_id FK zones`
- `dest_zone_id FK zones`
- `cylinder_type_id FK`
- `base_paisa bigint`
- `per_unit_paisa bigint`
- `effective_from, effective_until NULL`
- UNIQUE (city_id, origin_zone_id, dest_zone_id, cylinder_type_id, effective_from)

### payments
- `id uuid PK`
- `distributor_id FK`
- `amount_paisa bigint`
- `provider enum(JAZZCASH, EASYPAISA, BANK_MANUAL, CASH)`
- `provider_txn_id text`
- `status enum(PENDING, SUCCESS, FAILED, REFUNDED)`
- `proof_url NULL` (for manual bank)
- `verified_by_user_id NULL`
- `created_at, completed_at`
- UNIQUE (provider, provider_txn_id)

### ledger_entries
- `id uuid PK`
- `distributor_id FK`
- `entry_type enum(CREDIT_TOPUP, DEBIT_ORDER, ADJUSTMENT)`
- `amount_paisa bigint` (signed: + for credit, − for debit)
- `balance_after_paisa bigint`
- `payment_id FK NULL`
- `order_id FK NULL`
- `note`
- `created_at`

### reconciliations
- `id uuid PK`
- `driver_id FK`
- `for_date date`
- `expected_cash_paisa bigint`
- `submitted_cash_paisa bigint`
- `cylinders_delivered int`
- `cylinders_returned int`
- `status enum(PENDING, VERIFIED, FLAGGED)`

### support_tickets
- `id uuid PK`, `subject_type`, `subject_id`, `reporter_user_id`, `status`, `priority`, `body`, `assignee_user_id NULL`

### audit_logs
- `id uuid PK`, `actor_user_id`, `action`, `resource_type`, `resource_id`, `diff jsonb`, `ip`, `user_agent`, `created_at`

## Indices that matter
- GIST on `zones.polygon`, `stores.location`, `clients.address.location`, `drivers.current_location`, `orders.delivery_address`.
- BTREE on `cylinders(distributor_id, cylinder_type_id, state, custody_type)` for inventory math.
- BTREE on `cylinder_events(cylinder_id, created_at)` for custody history.
- BTREE on `ledger_entries(distributor_id, created_at DESC)`.

## Multi-tenancy
Every distributor-owned row carries `distributor_id`. Application-level guard injects `where: { distributor_id: ctx.distributorId }` for any DISTRIBUTOR-role query; staff bypass.

## PII at rest
- `users.cnic_encrypted` — AES-256-GCM, key from KMS/env.
- `users.cnic_index` — HMAC-SHA256 with separate pepper for blind-index lookups.
- Phone is not encrypted (lookup hot path); enforced unique with E.164 normalization.
