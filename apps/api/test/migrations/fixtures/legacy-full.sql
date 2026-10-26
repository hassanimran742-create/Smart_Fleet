-- The database sub-lane's legacy fixture (foundation proof, 2026-10-22), kept so the inc1a legacy path
-- can be re-proved on every change: rows shaped like today's (af889bf) data, written the way the old
-- code and demo seed wrote them. Every inc1a backfill path is exercised, and the shared home store
-- (DD and DE on S3) must block inc1a until DE is moved off it.

-- users ----------------------------------------------------------------------------------------
INSERT INTO users (id, phone, name, role, status, password_hash, created_at, updated_at) VALUES
 ('00000000-0000-0000-0000-0000000000a1', '+923000000000', 'LPG Super Admin',  'SUPER_ADMIN', 'ACTIVE', 'x', now() - interval '90 days', now()),
 ('00000000-0000-0000-0000-0000000000a2', '+923000000001', 'LPG Branch Admin', 'ADMIN',       'ACTIVE', 'x', now() - interval '90 days', now()),
 ('00000000-0000-0000-0000-0000000000d1', '+923111111111', 'Abdul Ghani',  'DISTRIBUTOR', 'ACTIVE',  'x', now() - interval '80 days', now()),
 ('00000000-0000-0000-0000-0000000000d2', '+923111111112', 'Bilal Ahmed',  'DISTRIBUTOR', 'ACTIVE',  'x', now() - interval '70 days', now()),
 ('00000000-0000-0000-0000-0000000000d3', '+923111111113', 'Chaudhry Ali', 'DISTRIBUTOR', 'PENDING', NULL, now() - interval '60 days', now()),
 ('00000000-0000-0000-0000-0000000000d4', '+923111111114', 'Danish Iqbal', 'DISTRIBUTOR', 'ACTIVE',  'x', now() - interval '50 days', now()),
 ('00000000-0000-0000-0000-0000000000d5', '+923111111115', 'Ehsan Khan',   'DISTRIBUTOR', 'ACTIVE',  'x', now() - interval '40 days', now()),
 ('00000000-0000-0000-0000-0000000000d6', '+923111111116', 'Faisal Raza',  'DISTRIBUTOR', 'ACTIVE',  'x', now() - interval '30 days', now()),
 ('00000000-0000-0000-0000-0000000000e1', '+923222222221', 'Ahmad Driver', 'DRIVER', 'ACTIVE', 'x', now() - interval '85 days', now()),
 ('00000000-0000-0000-0000-0000000000e2', '+923222222222', 'Imran Driver', 'DRIVER', 'ACTIVE', 'x', now() - interval '85 days', now());

-- geography ------------------------------------------------------------------------------------
INSERT INTO cities (id, name, country_code) VALUES ('00000000-0000-0000-0000-000000000001', 'Islamabad', 'PK');

-- Z1 and Z2 share the border at lat 33.70 and have the same area; Z3 is a small zone inside Z1;
-- Z4 is inactive and overlaps Z1's east edge.
INSERT INTO zones (id, city_id, name, polygon, centroid, is_active, created_at, updated_at) VALUES
 ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', 'F-Sectors',
  ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((73.03 33.70, 73.09 33.70, 73.09 33.74, 73.03 33.74, 73.03 33.70)))'), 4326),
  ST_SetSRID(ST_MakePoint(73.06, 33.72), 4326), true, now() - interval '89 days', now()),
 ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', 'G-Sectors',
  ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((73.03 33.66, 73.09 33.66, 73.09 33.70, 73.03 33.70, 73.03 33.66)))'), 4326),
  ST_SetSRID(ST_MakePoint(73.06, 33.68), 4326), true, now() - interval '88 days', now()),
 ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000000001', 'F-7 Markaz',
  ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((73.05 33.715, 73.06 33.715, 73.06 33.725, 73.05 33.725, 73.05 33.715)))'), 4326),
  ST_SetSRID(ST_MakePoint(73.055, 33.72), 4326), true, now() - interval '87 days', now()),
 ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-000000000001', 'Old Blue Area',
  ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((73.08 33.70, 73.12 33.70, 73.12 33.73, 73.08 33.73, 73.08 33.70)))'), 4326),
  ST_SetSRID(ST_MakePoint(73.10, 33.715), 4326), false, now() - interval '86 days', now());

INSERT INTO stores (id, name, zone_id, address, location, is_active, created_at, updated_at) VALUES
 ('00000000-0000-0000-0000-0000000000c1', 'F-Hub Store',  '00000000-0000-0000-0000-0000000000b1', 'F-7 Markaz',  ST_SetSRID(ST_MakePoint(73.0535, 33.7177), 4326), true, now() - interval '85 days', now()),
 ('00000000-0000-0000-0000-0000000000c2', 'G-Hub Store',  '00000000-0000-0000-0000-0000000000b2', 'G-9 Markaz',  ST_SetSRID(ST_MakePoint(73.0322, 33.6883), 4326), true, now() - interval '85 days', now()),
 ('00000000-0000-0000-0000-0000000000c3', 'Shared Depot', '00000000-0000-0000-0000-0000000000b1', 'F-10 Markaz', ST_SetSRID(ST_MakePoint(73.0400, 33.7000), 4326), true, now() - interval '84 days', now());

-- distributors: DC and DF have no store; DD and DE share S3 (the shared home store) -------------
--   DA: ledger history matches the cached balance (no opening entry)
--   DB: balance written directly by the demo seed, no ledger at all (opening entry +3,000,000)
--   DD: ledger sum 965,000 but cached 1,200,000 (opening entry +235,000)
--   DF: negative balance from an old refill debit, ledger matches
INSERT INTO distributors (id, user_id, business_name, home_store_id, advance_balance_paisa, status, created_at, updated_at) VALUES
 ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000d1', 'Al-Ghani Gas',     '00000000-0000-0000-0000-0000000000c1', 4803000, 'ACTIVE',  now() - interval '80 days', now()),
 ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000d2', 'Bismillah LPG',    '00000000-0000-0000-0000-0000000000c2', 3000000, 'ACTIVE',  now() - interval '70 days', now()),
 ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000d3', 'Chaudhry Traders', NULL,                                    0,       'PENDING', now() - interval '60 days', now()),
 ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000d4', 'Data Gas',         '00000000-0000-0000-0000-0000000000c3', 1200000, 'ACTIVE',  now() - interval '50 days', now()),
 ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-0000000000d5', 'Eagle Gas',        '00000000-0000-0000-0000-0000000000c3', 0,       'ACTIVE',  now() - interval '40 days', now()),
 ('00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-0000000000d6', 'Faisal Gas',       NULL,                                    -50000,  'ACTIVE',  now() - interval '30 days', now());

-- vehicles and drivers -----------------------------------------------------------------------
INSERT INTO vehicles (id, plate_no, capacity_units, home_zone_id, status, current_odometer_km, created_at, updated_at) VALUES
 ('00000000-0000-0000-0000-0000000000f1', 'ISB-101', 40, '00000000-0000-0000-0000-0000000000b1', 'ACTIVE', 1200, now() - interval '85 days', now()),
 ('00000000-0000-0000-0000-0000000000f2', 'ISB-102', 40, '00000000-0000-0000-0000-0000000000b2', 'ACTIVE', 800,  now() - interval '85 days', now());
INSERT INTO drivers (id, user_id, licence_no, current_vehicle_id, created_at, updated_at) VALUES
 ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000e1', 'DL-001', '00000000-0000-0000-0000-0000000000f1', now() - interval '85 days', now()),
 ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000e2', 'DL-002', '00000000-0000-0000-0000-0000000000f2', now() - interval '85 days', now());

INSERT INTO cylinder_types (id, code, name, weight_kg, capacity_units) VALUES
 ('00000000-0000-0000-0000-0000000000a9', 'LPG_11.8KG', 'LPG 11.8 kg', 11.8, 1),
 ('00000000-0000-0000-0000-0000000000aa', 'LPG_45.4KG', 'LPG 45.4 kg', 45.4, 4);

-- clients: phones as typed in the shop app ---------------------------------------------------
INSERT INTO clients (id, distributor_id, name, phone, created_at, updated_at) VALUES
 ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-00000000d001', 'Fatima',   '0300 1234567',     now() - interval '79 days', now()),
 ('00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-00000000d001', 'Ayesha',   '+92 301 2345678',  now() - interval '78 days', now()),
 ('00000000-0000-0000-0000-0000000c0003', '00000000-0000-0000-0000-00000000d001', 'Usman',    '0092-302-3456789', now() - interval '77 days', now()),
 ('00000000-0000-0000-0000-0000000c0004', '00000000-0000-0000-0000-00000000d002', 'Noor',     '3031234567',       now() - interval '69 days', now()),
 ('00000000-0000-0000-0000-0000000c0005', '00000000-0000-0000-0000-00000000d002', 'Hassan',   '051 1234567',      now() - interval '68 days', now()),
 ('00000000-0000-0000-0000-0000000c0006', '00000000-0000-0000-0000-00000000d004', 'Sara',     '+923041234567',    now() - interval '49 days', now()),
 ('00000000-0000-0000-0000-0000000c0007', '00000000-0000-0000-0000-00000000d004', 'Ahmed',    'call shop',        now() - interval '48 days', now()),
 ('00000000-0000-0000-0000-0000000c0008', '00000000-0000-0000-0000-00000000d001', 'Fatima 2', '03001234567',      now() - interval '20 days', now());

-- addresses: in the small nested zone, in Z1 only, in Z2, on the Z1/Z2 border, only in the
-- inactive zone, outside every zone
INSERT INTO client_addresses (id, client_id, label, location) VALUES
 ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-0000000c0001', 'Home',   ST_SetSRID(ST_MakePoint(73.055, 33.72), 4326)),
 ('00000000-0000-0000-0000-00000000ca02', '00000000-0000-0000-0000-0000000c0002', 'Home',   ST_SetSRID(ST_MakePoint(73.040, 33.73), 4326)),
 ('00000000-0000-0000-0000-00000000ca03', '00000000-0000-0000-0000-0000000c0004', 'Home',   ST_SetSRID(ST_MakePoint(73.050, 33.68), 4326)),
 ('00000000-0000-0000-0000-00000000ca04', '00000000-0000-0000-0000-0000000c0003', 'Office', ST_SetSRID(ST_MakePoint(73.060, 33.70), 4326)),
 ('00000000-0000-0000-0000-00000000ca05', '00000000-0000-0000-0000-0000000c0005', 'Home',   ST_SetSRID(ST_MakePoint(73.110, 33.72), 4326)),
 ('00000000-0000-0000-0000-00000000ca06', '00000000-0000-0000-0000-0000000c0006', 'Farm',   ST_SetSRID(ST_MakePoint(72.900, 33.50), 4326));

-- trips: completed, in progress, aborted --------------------------------------------------------
INSERT INTO trips (id, driver_id, vehicle_id, origin_store_id, status, planned_at, started_at, completed_at) VALUES
 ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', 'COMPLETED',   now() - interval '10 days 2 hours', now() - interval '10 days 1 hour', now() - interval '10 days'),
 ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c1', 'IN_PROGRESS', now() - interval '2 hours', now() - interval '1 hour', NULL),
 ('00000000-0000-0000-0000-00000000a103', '00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c2', 'ABORTED',     now() - interval '5 days 3 hours', NULL, now() - interval '5 days');

-- orders, as the old raw INSERT wrote them --------------------------------------------------------
INSERT INTO orders (id, distributor_id, client_id, delivery_address, delivery_address_label, dest_zone_id, origin_store_id,
                    status, payment_status, delivery_fee_paisa, trip_id, cancellation_reason, created_at, updated_at) VALUES
 ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000c0001', ST_SetSRID(ST_MakePoint(73.055, 33.72), 4326), 'Home', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'DELIVERED', 'PAID_VIA_LEDGER', 35000, '00000000-0000-0000-0000-00000000a101', NULL, now() - interval '11 days', now() - interval '9 days'),
 ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000c0002', ST_SetSRID(ST_MakePoint(73.040, 33.73), 4326), 'Home', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'DELIVERED', 'PAID_VIA_LEDGER', 42000, '00000000-0000-0000-0000-00000000a101', NULL, now() - interval '11 days', now() - interval '9 days'),
 ('00000000-0000-0000-0000-00000000b003', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000c0003', ST_SetSRID(ST_MakePoint(73.060, 33.70), 4326), 'Office', '00000000-0000-0000-0000-0000000000b1', NULL, 'CANCELLED', 'UNPAID', 0, NULL, 'customer changed mind', now() - interval '8 days', now() - interval '8 days'),
 ('00000000-0000-0000-0000-00000000b004', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000c0001', ST_SetSRID(ST_MakePoint(73.055, 33.72), 4326), 'Home', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c2', 'FAILED', 'UNPAID', 0, '00000000-0000-0000-0000-00000000a103', NULL, now() - interval '6 days', now() - interval '5 days'),
 ('00000000-0000-0000-0000-00000000b005', '00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000c0006', ST_SetSRID(ST_MakePoint(72.900, 33.50), 4326), 'Farm', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c3', 'DELIVERED', 'PAID_VIA_LEDGER', 35000, NULL, NULL, now() - interval '7 days', now() - interval '6 days'),
 ('00000000-0000-0000-0000-00000000b006', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000c0002', ST_SetSRID(ST_MakePoint(73.040, 33.73), 4326), 'Home', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'ASSIGNED', 'UNPAID', 0, '00000000-0000-0000-0000-00000000a102', NULL, now() - interval '3 hours', now() - interval '2 hours'),
 ('00000000-0000-0000-0000-00000000b007', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000c0008', ST_SetSRID(ST_MakePoint(73.055, 33.72), 4326), 'Home', '00000000-0000-0000-0000-0000000000b1', NULL, 'PENDING', 'UNPAID', 0, NULL, NULL, now() - interval '1 hour', now() - interval '1 hour'),
 ('00000000-0000-0000-0000-00000000b008', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000c0003', ST_SetSRID(ST_MakePoint(73.060, 33.70), 4326), 'Office', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'DELIVERED', 'UNPAID', 0, NULL, NULL, now() - interval '30 days', now() - interval '29 days'),
 ('00000000-0000-0000-0000-00000000b009', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000c0004', ST_SetSRID(ST_MakePoint(73.050, 33.68), 4326), 'Home', '00000000-0000-0000-0000-0000000000b2', NULL, 'PENDING', 'UNPAID', 0, NULL, NULL, now() - interval '2 days', now() - interval '2 days'),
 ('00000000-0000-0000-0000-00000000b010', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000c0004', ST_SetSRID(ST_MakePoint(73.050, 33.68), 4326), 'Home', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c2', 'DELIVERED', 'PAID_VIA_LEDGER', 28000, NULL, NULL, now() - interval '15 days', now() - interval '14 days');

INSERT INTO order_lines (id, order_id, cylinder_type_id, full_count, expected_return_count)
SELECT gen_random_uuid(), o.id, '00000000-0000-0000-0000-0000000000a9', 2, 2 FROM orders o;

INSERT INTO trip_stops (id, trip_id, order_id, seq, stop_type, location, arrived_at, departed_at) VALUES
 ('00000000-0000-0000-0000-00000000c101', '00000000-0000-0000-0000-00000000a101', NULL, 1, 'STORE_PICKUP', ST_SetSRID(ST_MakePoint(73.0535, 33.7177), 4326), now() - interval '10 days 1 hour', now() - interval '10 days 50 minutes'),
 ('00000000-0000-0000-0000-00000000c102', '00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-00000000b001', 2, 'DELIVERY', ST_SetSRID(ST_MakePoint(73.055, 33.72), 4326), now() - interval '10 days 30 minutes', now() - interval '10 days 20 minutes'),
 ('00000000-0000-0000-0000-00000000c103', '00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-00000000b002', 3, 'DELIVERY', ST_SetSRID(ST_MakePoint(73.040, 33.73), 4326), now() - interval '10 days 10 minutes', NULL),
 ('00000000-0000-0000-0000-00000000c201', '00000000-0000-0000-0000-00000000a102', NULL, 1, 'STORE_PICKUP', ST_SetSRID(ST_MakePoint(73.0535, 33.7177), 4326), now() - interval '50 minutes', NULL),
 ('00000000-0000-0000-0000-00000000c202', '00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-00000000b006', 2, 'DELIVERY', ST_SetSRID(ST_MakePoint(73.040, 33.73), 4326), NULL, NULL),
 ('00000000-0000-0000-0000-00000000c301', '00000000-0000-0000-0000-00000000a103', NULL, 1, 'STORE_PICKUP', ST_SetSRID(ST_MakePoint(73.0322, 33.6883), 4326), NULL, NULL),
 ('00000000-0000-0000-0000-00000000c302', '00000000-0000-0000-0000-00000000a103', '00000000-0000-0000-0000-00000000b004', 2, 'DELIVERY', ST_SetSRID(ST_MakePoint(73.055, 33.72), 4326), NULL, NULL);

-- payments: real gateway id, self-referencing and blank BANK_MANUAL placeholders, rejections ------
INSERT INTO payments (id, distributor_id, amount_paisa, provider, provider_txn_id, status, verified_by_user_id, created_at, completed_at) VALUES
 ('00000000-0000-0000-0000-0000000fa001', '00000000-0000-0000-0000-00000000d001', 5000000, 'EASYPAISA',   'EP-TXN-0001',                          'SUCCESS', NULL, now() - interval '79 days', now() - interval '79 days'),
 ('00000000-0000-0000-0000-0000000fa002', '00000000-0000-0000-0000-00000000d001', 1000000, 'BANK_MANUAL', '00000000-0000-0000-0000-0000000fa002', 'PENDING', NULL, now() - interval '1 day', NULL),
 ('00000000-0000-0000-0000-0000000fa003', '00000000-0000-0000-0000-00000000d004', 1000000, 'BANK_MANUAL', '00000000-0000-0000-0000-0000000fa003', 'SUCCESS', '00000000-0000-0000-0000-0000000000a1', now() - interval '49 days', now() - interval '49 days'),
 ('00000000-0000-0000-0000-0000000fa004', '00000000-0000-0000-0000-00000000d005', 500000,  'BANK_MANUAL', '',                                     'PENDING', NULL, now() - interval '2 days', NULL),
 ('00000000-0000-0000-0000-0000000fa005', '00000000-0000-0000-0000-00000000d003', 200000,  'BANK_MANUAL', '00000000-0000-0000-0000-0000000fa005', 'FAILED',  '00000000-0000-0000-0000-0000000000a1', now() - interval '59 days', now() - interval '58 days'),
 ('00000000-0000-0000-0000-0000000fa006', '00000000-0000-0000-0000-00000000d001', 300000,  'BANK_MANUAL', '00000000-0000-0000-0000-0000000fa006', 'FAILED',  '00000000-0000-0000-0000-0000000000a1', now() - interval '40 days', now() - interval '40 days');

-- refills: two completed (debited via an ADJUSTMENT row with the old note), one pending -----------
INSERT INTO filling_stations (id, name, address, location, price_per_cylinder_paisa, is_active, created_at, updated_at) VALUES
 ('00000000-0000-0000-0000-0000000fc001', 'Rawat Filling', 'GT Road', ST_SetSRID(ST_MakePoint(73.20, 33.50), 4326), 12000, true, now() - interval '85 days', now());
INSERT INTO filling_orders (id, distributor_id, filling_station_id, cylinder_type_id, requested_count, filled_count,
                            price_per_cylinder_paisa, total_cost_paisa, status, created_at, updated_at, completed_at) VALUES
 ('f1f1f1f1-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000fc001', '00000000-0000-0000-0000-0000000000a9', 10, 10, 12000, 120000, 'COMPLETED', now() - interval '20 days', now() - interval '19 days', now() - interval '19 days'),
 ('f2f2f2f2-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-0000000fc001', '00000000-0000-0000-0000-0000000000a9', 5, 5, 10000, 50000, 'COMPLETED', now() - interval '25 days', now() - interval '24 days', now() - interval '24 days'),
 ('f3f3f3f3-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000fc001', '00000000-0000-0000-0000-0000000000a9', 4, NULL, 12000, 48000, 'PENDING', now() - interval '1 day', now() - interval '1 day', NULL);

-- ledger, with no keys, as ledger.service.ts / payments.service.ts / filling-orders.service.ts wrote it
INSERT INTO ledger_entries (id, distributor_id, entry_type, amount_paisa, balance_after_paisa, payment_id, order_id, note, created_at) VALUES
 ('00000000-0000-0000-0000-0000000fb001', '00000000-0000-0000-0000-00000000d001', 'CREDIT_TOPUP', 5000000, 5000000, '00000000-0000-0000-0000-0000000fa001', NULL, 'Top-up via EASYPAISA', now() - interval '79 days'),
 ('00000000-0000-0000-0000-0000000fb002', '00000000-0000-0000-0000-00000000d001', 'DEBIT_ORDER', -35000, 4965000, NULL, '00000000-0000-0000-0000-00000000b001', 'Delivery fee', now() - interval '10 days 20 minutes'),
 ('00000000-0000-0000-0000-0000000fb003', '00000000-0000-0000-0000-00000000d001', 'DEBIT_ORDER', -42000, 4923000, NULL, '00000000-0000-0000-0000-00000000b002', 'Delivery fee', now() - interval '10 days 5 minutes'),
 ('00000000-0000-0000-0000-0000000fb004', '00000000-0000-0000-0000-00000000d001', 'ADJUSTMENT', -120000, 4803000, NULL, NULL, 'Filling order f1f1f1f1 — 10 cylinders filled', now() - interval '19 days'),
 ('00000000-0000-0000-0000-0000000fb005', '00000000-0000-0000-0000-00000000d004', 'CREDIT_TOPUP', 1000000, 1000000, '00000000-0000-0000-0000-0000000fa003', NULL, 'Top-up via BANK_MANUAL', now() - interval '49 days'),
 ('00000000-0000-0000-0000-0000000fb006', '00000000-0000-0000-0000-00000000d004', 'DEBIT_ORDER', -35000, 965000, NULL, '00000000-0000-0000-0000-00000000b005', 'Delivery fee', now() - interval '6 days'),
 ('00000000-0000-0000-0000-0000000fb007', '00000000-0000-0000-0000-00000000d006', 'ADJUSTMENT', -50000, -50000, NULL, NULL, 'Filling order f2f2f2f2 — 5 cylinders filled', now() - interval '24 days');

-- expenses with the old fixed categories --------------------------------------------------------
INSERT INTO expenses (id, category, description, amount_paisa, expense_date, recorded_by_user_id, vendor, created_at, updated_at) VALUES
 ('00000000-0000-0000-0000-0000000ee001', 'FUEL',        'Diesel van ISB-101', 850000, current_date - 10, '00000000-0000-0000-0000-0000000000a1', 'PSO', now() - interval '10 days', now()),
 ('00000000-0000-0000-0000-0000000ee002', 'MAINTENANCE', 'Oil change',         300000, current_date - 9,  '00000000-0000-0000-0000-0000000000a1', NULL,  now() - interval '9 days', now()),
 ('00000000-0000-0000-0000-0000000ee003', 'OTHER',       'Misc',                50000, current_date - 8,  '00000000-0000-0000-0000-0000000000a1', NULL,  now() - interval '8 days', now()),
 ('00000000-0000-0000-0000-0000000ee004', 'FOOD',        'Staff lunch',         120000, current_date - 7, '00000000-0000-0000-0000-0000000000a1', NULL,  now() - interval '7 days', now()),
 ('00000000-0000-0000-0000-0000000ee005', 'UTILITIES',   'Electricity',         900000, current_date - 6, '00000000-0000-0000-0000-0000000000a1', NULL,  now() - interval '6 days', now()),
 ('00000000-0000-0000-0000-0000000ee006', 'RENT',        'Depot rent',         5000000, current_date - 5, '00000000-0000-0000-0000-0000000000a1', NULL,  now() - interval '5 days', now()),
 ('00000000-0000-0000-0000-0000000ee007', 'FOOD',        'Tea',                  20000, current_date - 4, '00000000-0000-0000-0000-0000000000a1', NULL,  now() - interval '4 days', now());

-- audit rows the old code could have written (USER actor) ---------------------------------------
INSERT INTO audit_logs (id, actor_user_id, action, resource_type, resource_id, created_at) VALUES
 ('00000000-0000-0000-0000-0000000ad001', '00000000-0000-0000-0000-0000000000a1', 'payment.verify', 'Payment', '00000000-0000-0000-0000-0000000fa003', now() - interval '49 days');
