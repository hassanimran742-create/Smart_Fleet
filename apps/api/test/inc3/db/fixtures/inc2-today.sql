-- Today's data, as the Increment 2 code writes it (a database at the Increment 2 release: 0_baseline,
-- inc1a, inc1b and inc2 applied), for the Increment 3 release (inc3_refills_dayend). Loaded with
-- `prisma db execute` after `prisma migrate deploy` of the inc2 release. No money moves in this file
-- except what the Inc 1 and Inc 2 code writes: a top-up and an order cost, each with its ledger row.
--
--   AG (Ahmed Gas): a store, Rs 5,600 after a top-up of Rs 6,000 and one delivered order (Rs 400);
--     customers Sana and Usman; cylinders AG-C0001…AG-C0004 (labelled in Inc 2); one run T1 finished by
--     scans (a hand-over and a take-back, with their stop rows), a confirmation answered NO and its case.
--   BG (Bilal Gas): a store, Rs 0, customer Hina, cylinder BG-C0001.
--   Refills (count steps, no number yet), none in flight, so the inc3 pre-check passes:
--     AG: F1 FAILED (Oct 2), F2 COMPLETED (Oct 3), F3 CANCELLED (Oct 4, updated 12:00), F4 and F5 PENDING
--         with the same created_at (Oct 5: the id decides, F4 then F5). Numbers 1 to 5; next_refill_no 6.
--     BG: next_refill_no is already 3 (as if two numbers were used): G1 COMPLETED (Oct 3) and G2 PENDING
--         (Oct 6) get 3 and 4, and the counter becomes 5.

-- people -----------------------------------------------------------------------------------------
INSERT INTO users (id, phone, name, role, status, password_hash, token_version, created_at, updated_at) VALUES
 ('20000000-0000-4000-8000-0000000000a1', '+923331000001', 'Owner',     'SUPER_ADMIN', 'ACTIVE', 'x', 0, '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z'),
 ('20000000-0000-4000-8000-000000000da1', '+923211234567', 'Ahmed Gas', 'DISTRIBUTOR', 'ACTIVE', 'x', 0, '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z'),
 ('20000000-0000-4000-8000-000000000db1', '+923227654321', 'Bilal Gas', 'DISTRIBUTOR', 'ACTIVE', 'x', 0, '2026-10-02T08:00:00Z', '2026-10-02T08:00:00Z'),
 ('20000000-0000-4000-8000-000000000e01', '+923451000001', 'Kashif',    'DRIVER',      'ACTIVE', 'x', 0, '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z'),
 ('20000000-0000-4000-8000-000000000e02', '+923451000002', 'Imran',     'DRIVER',      'ACTIVE', 'x', 0, '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z');

-- geography --------------------------------------------------------------------------------------
INSERT INTO cities (id, name, country_code) VALUES ('20000000-0000-4000-8000-0000000000c1', 'Lahore', 'PK');

INSERT INTO zones (id, city_id, name, polygon, centroid, is_active, created_at, updated_at) VALUES
 ('20000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000c1', 'North',
  ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((74.20 31.50, 74.25 31.50, 74.25 31.55, 74.20 31.55, 74.20 31.50)))'), 4326),
  ST_SetSRID(ST_MakePoint(74.225, 31.525), 4326), true, '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z'),
 ('20000000-0000-4000-8000-0000000000e2', '20000000-0000-4000-8000-0000000000c1', 'South',
  ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((74.25 31.50, 74.30 31.50, 74.30 31.55, 74.25 31.55, 74.25 31.50)))'), 4326),
  ST_SetSRID(ST_MakePoint(74.275, 31.525), 4326), true, '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z');

INSERT INTO stores (id, name, zone_id, address, location, is_active, created_at, updated_at) VALUES
 ('20000000-0000-4000-8000-0000000005a1', 'Ahmed Gas Store',    '20000000-0000-4000-8000-0000000000e1', 'Mall Road',    ST_SetSRID(ST_MakePoint(74.22, 31.52), 4326), true, '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z'),
 ('20000000-0000-4000-8000-0000000005b1', 'Bilal Gas''s store', '20000000-0000-4000-8000-0000000000e2', 'Ferozepur Rd', ST_SetSRID(ST_MakePoint(74.28, 31.52), 4326), true, '2026-10-02T08:00:00Z', '2026-10-02T08:00:00Z');

INSERT INTO distributors (id, user_id, business_name, code, home_store_id, advance_balance_paisa, status,
                          next_order_no, next_topup_no, next_refill_no, next_cylinder_no, created_at, updated_at) VALUES
 ('20000000-0000-4000-8000-00000000da00', '20000000-0000-4000-8000-000000000da1', 'Ahmed Gas', 'AG', '20000000-0000-4000-8000-0000000005a1', 560000, 'ACTIVE', 2, 2, 1, 5, '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z'),
 ('20000000-0000-4000-8000-00000000db00', '20000000-0000-4000-8000-000000000db1', 'Bilal Gas', 'BG', '20000000-0000-4000-8000-0000000005b1', 0,      'ACTIVE', 1, 1, 3, 2, '2026-10-02T08:00:00Z', '2026-10-02T08:00:00Z');

INSERT INTO vehicles (id, plate_no, capacity_units, home_zone_id, status, current_odometer_km, created_at, updated_at) VALUES
 ('20000000-0000-4000-8000-0000000000f1', 'LEA-101', 40, '20000000-0000-4000-8000-0000000000e1', 'ACTIVE', 1000, '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z'),
 ('20000000-0000-4000-8000-0000000000f2', 'LEB-202', 40, '20000000-0000-4000-8000-0000000000e2', 'ACTIVE', 500,  '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z');
INSERT INTO drivers (id, user_id, licence_no, current_vehicle_id, created_at, updated_at) VALUES
 ('20000000-0000-4000-8000-00000000e001', '20000000-0000-4000-8000-000000000e01', 'DL-1001', '20000000-0000-4000-8000-0000000000f1', '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z'),
 ('20000000-0000-4000-8000-00000000e002', '20000000-0000-4000-8000-000000000e02', 'DL-1002', '20000000-0000-4000-8000-0000000000f2', '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z');

INSERT INTO cylinder_types (id, code, name, weight_kg, capacity_units) VALUES
 ('20000000-0000-4000-8000-0000000000a9', 'STD_11_8KG', '11.8 kg', 11.8, 1),
 ('20000000-0000-4000-8000-0000000000aa', 'STD_15KG',   '15 kg',   15,   1);

INSERT INTO distributor_zone_prices (id, distributor_id, zone_id, base_paisa, created_at, updated_at) VALUES
 ('20000000-0000-4000-8000-0000000002a1', '20000000-0000-4000-8000-00000000da00', '20000000-0000-4000-8000-0000000000e1', 40000, '2026-10-01T09:00:00Z', '2026-10-01T09:00:00Z'),
 ('20000000-0000-4000-8000-0000000002b1', '20000000-0000-4000-8000-00000000db00', '20000000-0000-4000-8000-0000000000e2', 30000, '2026-10-02T09:00:00Z', '2026-10-02T09:00:00Z');

INSERT INTO clients (id, distributor_id, name, phone, created_at, updated_at) VALUES
 ('20000000-0000-4000-8000-00000000c001', '20000000-0000-4000-8000-00000000da00', 'Sana',  '+923001234567', '2026-10-03T09:00:00Z', '2026-10-03T09:00:00Z'),
 ('20000000-0000-4000-8000-00000000c002', '20000000-0000-4000-8000-00000000da00', 'Usman', '+923217654321', '2026-10-03T09:05:00Z', '2026-10-03T09:05:00Z'),
 ('20000000-0000-4000-8000-00000000c003', '20000000-0000-4000-8000-00000000db00', 'Hina',  '+923009876543', '2026-10-03T09:10:00Z', '2026-10-03T09:10:00Z');
INSERT INTO client_addresses (id, client_id, label, location, zone_id, created_at) VALUES
 ('20000000-0000-4000-8000-0000000ca001', '20000000-0000-4000-8000-00000000c001', 'Sana''s house',  ST_SetSRID(ST_MakePoint(74.23, 31.53), 4326), '20000000-0000-4000-8000-0000000000e1', '2026-10-03T09:00:00Z'),
 ('20000000-0000-4000-8000-0000000ca003', '20000000-0000-4000-8000-00000000c003', 'Hina''s house',  ST_SetSRID(ST_MakePoint(74.28, 31.51), 4326), '20000000-0000-4000-8000-0000000000e2', '2026-10-03T09:10:00Z');

-- a stored file (a top-up proof) and the top-up -------------------------------------------------------
INSERT INTO stored_files (id, storage_key, purpose, mime_type, size_bytes, sha256, original_name, uploaded_by_user_id, distributor_id, created_at) VALUES
 ('20000000-0000-4000-8000-0000000f11e1', 'uploads/2026-10-03/20000000-0000-4000-8000-0000000f11e1.jpg', 'TOPUP_PROOF', 'image/jpeg', 2048,
  repeat('a', 64), 'proof.jpg', '20000000-0000-4000-8000-000000000da1', '20000000-0000-4000-8000-00000000da00', '2026-10-03T09:29:00Z');
INSERT INTO payments (id, distributor_id, request_no, amount_paisa, provider, provider_txn_id, status, payer_name, payer_channel, proof_file_id,
                      bank_reference, bank_reference_key, bank_amount_paisa, bank_received_at, verified_by_user_id, created_at, completed_at) VALUES
 ('20000000-0000-4000-8000-0000000fa001', '20000000-0000-4000-8000-00000000da00', 1, 600000, 'BANK_MANUAL', NULL, 'SUCCESS', 'Ahmed', 'BANK_APP',
  '20000000-0000-4000-8000-0000000f11e1', 'FT 2026 1001', 'FT20261001', 600000, '2026-10-03T10:00:00Z', '20000000-0000-4000-8000-0000000000a1',
  '2026-10-03T09:30:00Z', '2026-10-03T10:05:00Z');

-- the delivered run T1 (Kashif, LEA-101), finished by scans ----------------------------------------
INSERT INTO trips (id, driver_id, vehicle_id, origin_store_id, status, planned_at, started_at, completed_at) VALUES
 ('20000000-0000-4000-8000-0000000071a1', '20000000-0000-4000-8000-00000000e001', '20000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000005a1', 'COMPLETED', '2026-10-06T08:00:00Z', '2026-10-06T08:30:00Z', '2026-10-06T12:00:00Z');

INSERT INTO orders (id, distributor_id, client_id, delivery_address, delivery_address_label, dest_zone_id, origin_store_id, order_no,
                    status, payment_status, delivery_fee_paisa, fee_status, fee_strategy, fee_base_paisa, fee_quoted_at, trip_id,
                    assigned_at, load_started_at, on_the_way_at, delivered_at, delivered_by_user_id, delivery_method, created_at, updated_at) VALUES
 ('20000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-00000000da00', '20000000-0000-4000-8000-00000000c001', ST_SetSRID(ST_MakePoint(74.23, 31.53), 4326), 'Sana''s house', '20000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000005a1', 1,
  'DELIVERED', 'PAID_VIA_LEDGER', 40000, 'DEDUCTED', 'DISTRIBUTOR_ZONE', 40000, '2026-10-06T07:50:00Z', '20000000-0000-4000-8000-0000000071a1',
  '2026-10-06T08:00:00Z', '2026-10-06T08:35:00Z', '2026-10-06T09:00:00Z', '2026-10-06T10:00:00Z', '20000000-0000-4000-8000-000000000e01', 'SCANNED',
  '2026-10-06T07:50:00Z', '2026-10-06T10:00:00Z');
INSERT INTO order_lines (id, order_id, cylinder_type_id, full_count, expected_return_count, fee_per_cylinder_paisa, fee_paisa) VALUES
 ('20000000-0000-4000-8000-0000000001b1', '20000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000a9', 1, 1, 0, 0);

INSERT INTO trip_stops (id, trip_id, order_id, store_id, seq, stop_type, status, location, arrived_at, departed_at, completed_at) VALUES
 ('20000000-0000-4000-8000-0000000072a1', '20000000-0000-4000-8000-0000000071a1', NULL, '20000000-0000-4000-8000-0000000005a1', 0, 'STORE_PICKUP', 'DONE',
  ST_SetSRID(ST_MakePoint(74.22, 31.52), 4326), '2026-10-06T08:35:00Z', '2026-10-06T09:00:00Z', '2026-10-06T09:00:00Z'),
 ('20000000-0000-4000-8000-0000000072a2', '20000000-0000-4000-8000-0000000071a1', '20000000-0000-4000-8000-0000000000b1', NULL, 1, 'DELIVERY', 'DONE',
  ST_SetSRID(ST_MakePoint(74.23, 31.53), 4326), '2026-10-06T09:40:00Z', '2026-10-06T10:00:00Z', '2026-10-06T10:00:00Z');

-- the ledger (the sum is the balance) -------------------------------------------------------------
INSERT INTO ledger_entries (id, distributor_id, entry_type, amount_paisa, balance_after_paisa, idempotency_key, payment_id, order_id, created_by_user_id, created_at) VALUES
 ('20000000-0000-4000-8000-0000000e0001', '20000000-0000-4000-8000-00000000da00', 'CREDIT_TOPUP', 600000, 600000, 'topup:20000000-0000-4000-8000-0000000fa001', '20000000-0000-4000-8000-0000000fa001', NULL, '20000000-0000-4000-8000-0000000000a1', '2026-10-03T10:05:00Z'),
 ('20000000-0000-4000-8000-0000000e0002', '20000000-0000-4000-8000-00000000da00', 'DEBIT_ORDER',  -40000, 560000, 'order:20000000-0000-4000-8000-0000000000b1:debit', NULL, '20000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-000000000da1', '2026-10-06T07:50:00Z');

-- labelled cylinders (Inc 2 bulk-register) and their moves ----------------------------------------
--   AG-C0001 FULL in the store (registered only).
--   AG-C0002 FULL with Sana: registered, loaded on T1, handed over (a GIVEN row).
--   AG-C0003 EMPTY in the store: Sana's old one, taken back on T1 (a TAKEN_BACK row), received by the shop (typed).
--   AG-C0004 EMPTY in the store: registered EMPTY.
--   BG-C0001 FULL in Bilal Gas's store.
INSERT INTO cylinders (id, serial, qr_code, distributor_id, cylinder_type_id, short_no, state, custody_type, custody_id, created_at, updated_at) VALUES
 ('20000000-0000-4000-8000-00000000ca01', 'SN-AG-C0001', 'QR-AG-C0001', '20000000-0000-4000-8000-00000000da00', '20000000-0000-4000-8000-0000000000a9', 1, 'FULL',  'STORE',  '20000000-0000-4000-8000-0000000005a1', '2026-10-02T09:00:00Z', '2026-10-02T09:00:00Z'),
 ('20000000-0000-4000-8000-00000000ca02', 'SN-AG-C0002', 'QR-AG-C0002', '20000000-0000-4000-8000-00000000da00', '20000000-0000-4000-8000-0000000000a9', 2, 'FULL',  'CLIENT', '20000000-0000-4000-8000-00000000c001', '2026-10-02T09:00:00Z', '2026-10-06T09:45:00Z'),
 ('20000000-0000-4000-8000-00000000ca03', 'SN-AG-C0003', 'QR-AG-C0003', '20000000-0000-4000-8000-00000000da00', '20000000-0000-4000-8000-0000000000a9', 3, 'EMPTY', 'STORE',  '20000000-0000-4000-8000-0000000005a1', '2026-10-02T09:00:00Z', '2026-10-06T11:30:00Z'),
 ('20000000-0000-4000-8000-00000000ca04', 'SN-AG-C0004', 'QR-AG-C0004', '20000000-0000-4000-8000-00000000da00', '20000000-0000-4000-8000-0000000000aa', 4, 'EMPTY', 'STORE',  '20000000-0000-4000-8000-0000000005a1', '2026-10-02T09:00:00Z', '2026-10-02T09:00:00Z'),
 ('20000000-0000-4000-8000-00000000cb01', 'SN-BG-C0001', 'QR-BG-C0001', '20000000-0000-4000-8000-00000000db00', '20000000-0000-4000-8000-0000000000a9', 1, 'FULL',  'STORE',  '20000000-0000-4000-8000-0000000005b1', '2026-10-02T10:00:00Z', '2026-10-02T10:00:00Z');

INSERT INTO cylinder_events (id, cylinder_id, event_type, source, from_custody_type, from_custody_id, to_custody_type, to_custody_id, from_state, to_state,
                             reason, actor_user_id, client_scan_id, trip_id, trip_stop_id, order_id, created_at) VALUES
 ('20000000-0000-4000-8000-0000000ce101', '20000000-0000-4000-8000-00000000ca01', 'REGISTERED', 'REGISTRATION', NULL, NULL, 'STORE', '20000000-0000-4000-8000-0000000005a1', NULL, 'FULL',
  NULL, '20000000-0000-4000-8000-0000000000a1', NULL, NULL, NULL, NULL, '2026-10-02T09:00:00Z'),
 ('20000000-0000-4000-8000-0000000ce201', '20000000-0000-4000-8000-00000000ca02', 'REGISTERED', 'REGISTRATION', NULL, NULL, 'STORE', '20000000-0000-4000-8000-0000000005a1', NULL, 'FULL',
  NULL, '20000000-0000-4000-8000-0000000000a1', NULL, NULL, NULL, NULL, '2026-10-02T09:00:00Z'),
 ('20000000-0000-4000-8000-0000000ce202', '20000000-0000-4000-8000-00000000ca02', 'SCAN_OUT', 'SCAN', 'STORE', '20000000-0000-4000-8000-0000000005a1', 'VEHICLE', '20000000-0000-4000-8000-0000000000f1', 'FULL', 'FULL',
  NULL, '20000000-0000-4000-8000-000000000e01', '21000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000071a1', '20000000-0000-4000-8000-0000000072a1', NULL, '2026-10-06T08:35:00Z'),
 ('20000000-0000-4000-8000-0000000ce203', '20000000-0000-4000-8000-00000000ca02', 'DELIVERED', 'SCAN', 'VEHICLE', '20000000-0000-4000-8000-0000000000f1', 'CLIENT', '20000000-0000-4000-8000-00000000c001', 'FULL', 'FULL',
  NULL, '20000000-0000-4000-8000-000000000e01', '21000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000071a1', '20000000-0000-4000-8000-0000000072a2', '20000000-0000-4000-8000-0000000000b1', '2026-10-06T09:45:00Z'),
 ('20000000-0000-4000-8000-0000000ce301', '20000000-0000-4000-8000-00000000ca03', 'REGISTERED', 'REGISTRATION', NULL, NULL, 'STORE', '20000000-0000-4000-8000-0000000005a1', NULL, 'FULL',
  NULL, '20000000-0000-4000-8000-0000000000a1', NULL, NULL, NULL, NULL, '2026-10-02T09:00:00Z'),
 ('20000000-0000-4000-8000-0000000ce302', '20000000-0000-4000-8000-00000000ca03', 'DELIVERED', 'MANUAL', 'STORE', '20000000-0000-4000-8000-0000000005a1', 'CLIENT', '20000000-0000-4000-8000-00000000c001', 'FULL', 'FULL',
  'Delivered before the scans started', '20000000-0000-4000-8000-0000000000a1', NULL, NULL, NULL, NULL, '2026-10-03T09:00:00Z'),
 ('20000000-0000-4000-8000-0000000ce303', '20000000-0000-4000-8000-00000000ca03', 'PICKED_UP_EMPTY', 'SCAN', 'CLIENT', '20000000-0000-4000-8000-00000000c001', 'VEHICLE', '20000000-0000-4000-8000-0000000000f1', 'FULL', 'EMPTY',
  NULL, '20000000-0000-4000-8000-000000000e01', '21000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-0000000071a1', '20000000-0000-4000-8000-0000000072a2', '20000000-0000-4000-8000-0000000000b1', '2026-10-06T09:50:00Z'),
 ('20000000-0000-4000-8000-0000000ce304', '20000000-0000-4000-8000-00000000ca03', 'SCAN_IN', 'TYPED', 'VEHICLE', '20000000-0000-4000-8000-0000000000f1', 'STORE', '20000000-0000-4000-8000-0000000005a1', 'EMPTY', 'EMPTY',
  NULL, '20000000-0000-4000-8000-000000000da1', '21000000-0000-4000-8000-000000000004', NULL, NULL, NULL, '2026-10-06T11:30:00Z'),
 ('20000000-0000-4000-8000-0000000ce401', '20000000-0000-4000-8000-00000000ca04', 'REGISTERED', 'REGISTRATION', NULL, NULL, 'STORE', '20000000-0000-4000-8000-0000000005a1', NULL, 'EMPTY',
  NULL, '20000000-0000-4000-8000-0000000000a1', NULL, NULL, NULL, NULL, '2026-10-02T09:00:00Z'),
 ('20000000-0000-4000-8000-0000000ceb01', '20000000-0000-4000-8000-00000000cb01', 'REGISTERED', 'REGISTRATION', NULL, NULL, 'STORE', '20000000-0000-4000-8000-0000000005b1', NULL, 'FULL',
  NULL, '20000000-0000-4000-8000-0000000000a1', NULL, NULL, NULL, NULL, '2026-10-02T10:00:00Z');

UPDATE cylinders SET last_event_id = '20000000-0000-4000-8000-0000000ce101' WHERE id = '20000000-0000-4000-8000-00000000ca01';
UPDATE cylinders SET last_event_id = '20000000-0000-4000-8000-0000000ce203' WHERE id = '20000000-0000-4000-8000-00000000ca02';
UPDATE cylinders SET last_event_id = '20000000-0000-4000-8000-0000000ce304' WHERE id = '20000000-0000-4000-8000-00000000ca03';
UPDATE cylinders SET last_event_id = '20000000-0000-4000-8000-0000000ce401' WHERE id = '20000000-0000-4000-8000-00000000ca04';
UPDATE cylinders SET last_event_id = '20000000-0000-4000-8000-0000000ceb01' WHERE id = '20000000-0000-4000-8000-00000000cb01';

INSERT INTO stop_cylinders (id, trip_stop_id, order_id, cylinder_id, cylinder_type_id, direction, return_state, event_id, created_at) VALUES
 ('20000000-0000-4000-8000-0000000c5c01', '20000000-0000-4000-8000-0000000072a2', '20000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-00000000ca02', '20000000-0000-4000-8000-0000000000a9', 'GIVEN', NULL,
  '20000000-0000-4000-8000-0000000ce203', '2026-10-06T09:45:00Z'),
 ('20000000-0000-4000-8000-0000000c5c02', '20000000-0000-4000-8000-0000000072a2', '20000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-00000000ca03', '20000000-0000-4000-8000-0000000000a9', 'TAKEN_BACK', 'EMPTY',
  '20000000-0000-4000-8000-0000000ce303', '2026-10-06T09:50:00Z');

-- the customer's answer and its case ----------------------------------------------------------------
INSERT INTO delivery_confirmations (id, order_id, distributor_id, token_hash, token_version, status, expires_at, phone_e164, snapshot,
                                    response, comment, responded_at, created_at, updated_at) VALUES
 ('20000000-0000-4000-8000-0000000dc001', '20000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-00000000da00', repeat('b', 64), 1, 'ANSWERED',
  '2026-10-09T10:00:00Z', '+923001234567', '{"orderShortCode":"AG-0001"}', 'NO', 'Nothing came', '2026-10-06T11:00:00Z', '2026-10-06T10:00:00Z', '2026-10-06T11:00:00Z');
INSERT INTO outbound_messages (id, channel, provider, to_phone_e164, template_key, body_redacted, status, error_code, idempotency_key,
                               confirmation_id, token_version, order_id, distributor_id, created_at) VALUES
 ('20000000-0000-4000-8000-0000000d0001', 'SMS', 'mock', '+923001234567', 'sms.deliveryConfirm.v1', 'Ahmed Gas: Order AG-0001 delivered. Did you get it? Tap [link]',
  'SKIPPED', 'NOT_A_TEST_PHONE', 'confirm:20000000-0000-4000-8000-0000000000b1:v1:sms', '20000000-0000-4000-8000-0000000dc001', 1,
  '20000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-00000000da00', '2026-10-06T10:00:00Z');
INSERT INTO alerts (id, alert_type, severity, status, title, body, resource_type, resource_id, distributor_id, context, created_at, updated_at) VALUES
 ('20000000-0000-4000-8000-00000000a1e1', 'CUSTOMER_PROBLEM', 'WARNING', 'OPEN', 'Customer problem', 'Sana answered "Not received".', 'Order',
  '20000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-00000000da00',
  '{"orderId":"20000000-0000-4000-8000-0000000000b1","orderShortCode":"AG-0001","answer":"NO","comment":"Nothing came"}', '2026-10-06T11:00:00Z', '2026-10-06T11:00:00Z');

-- refills (the Inc 1 count steps; no number yet), none in flight -----------------------------------
INSERT INTO filling_stations (id, name, address, location, price_per_cylinder_paisa, is_active, created_at, updated_at) VALUES
 ('20000000-0000-4000-8000-0000000005f1', 'Lahore Filling Station', 'Ring Road', ST_SetSRID(ST_MakePoint(74.24, 31.54), 4326), 0, true, '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z');
INSERT INTO filling_orders (id, distributor_id, filling_station_id, cylinder_type_id, service_type, requested_count, picked_up_empty_count, filled_count,
                            price_per_cylinder_paisa, total_cost_paisa, status, assigned_driver_id, assigned_vehicle_id, pickup_store_id,
                            cancellation_reason, created_at, updated_at, completed_at) VALUES
 ('20000000-0000-4000-8000-0000000fd001', '20000000-0000-4000-8000-00000000da00', '20000000-0000-4000-8000-0000000005f1', '20000000-0000-4000-8000-0000000000a9', 'OUR_SERVICE', 2, NULL, NULL,
  0, 0, 'FAILED', NULL, NULL, '20000000-0000-4000-8000-0000000005a1', NULL, '2026-10-02T09:00:00Z', '2026-10-02T15:00:00Z', NULL),
 ('20000000-0000-4000-8000-0000000fd002', '20000000-0000-4000-8000-00000000da00', '20000000-0000-4000-8000-0000000005f1', '20000000-0000-4000-8000-0000000000a9', 'OUR_SERVICE', 2, 2, 2,
  0, 0, 'COMPLETED', '20000000-0000-4000-8000-00000000e002', '20000000-0000-4000-8000-0000000000f2', '20000000-0000-4000-8000-0000000005a1', NULL, '2026-10-03T09:00:00Z', '2026-10-03T16:00:00Z', '2026-10-03T16:00:00Z'),
 ('20000000-0000-4000-8000-0000000fd003', '20000000-0000-4000-8000-00000000da00', '20000000-0000-4000-8000-0000000005f1', '20000000-0000-4000-8000-0000000000a9', 'OUR_SERVICE', 3, NULL, NULL,
  0, 0, 'CANCELLED', NULL, NULL, '20000000-0000-4000-8000-0000000005a1', 'Not needed', '2026-10-04T09:00:00Z', '2026-10-04T12:00:00Z', NULL),
 ('20000000-0000-4000-8000-0000000fd004', '20000000-0000-4000-8000-00000000da00', '20000000-0000-4000-8000-0000000005f1', '20000000-0000-4000-8000-0000000000a9', 'OUR_SERVICE', 1, NULL, NULL,
  0, 0, 'PENDING', NULL, NULL, '20000000-0000-4000-8000-0000000005a1', NULL, '2026-10-05T09:00:00Z', '2026-10-05T09:00:00Z', NULL),
 ('20000000-0000-4000-8000-0000000fd005', '20000000-0000-4000-8000-00000000da00', '20000000-0000-4000-8000-0000000005f1', '20000000-0000-4000-8000-0000000000aa', 'OUR_SERVICE', 4, NULL, NULL,
  0, 0, 'PENDING', NULL, NULL, '20000000-0000-4000-8000-0000000005a1', NULL, '2026-10-05T09:00:00Z', '2026-10-05T09:00:00Z', NULL),
 ('20000000-0000-4000-8000-0000000fd101', '20000000-0000-4000-8000-00000000db00', '20000000-0000-4000-8000-0000000005f1', '20000000-0000-4000-8000-0000000000a9', 'OUR_SERVICE', 1, 1, 1,
  0, 0, 'COMPLETED', '20000000-0000-4000-8000-00000000e002', '20000000-0000-4000-8000-0000000000f2', '20000000-0000-4000-8000-0000000005b1', NULL, '2026-10-03T10:00:00Z', '2026-10-03T17:00:00Z', '2026-10-03T17:00:00Z'),
 ('20000000-0000-4000-8000-0000000fd102', '20000000-0000-4000-8000-00000000db00', '20000000-0000-4000-8000-0000000005f1', '20000000-0000-4000-8000-0000000000a9', 'OUR_SERVICE', 2, NULL, NULL,
  0, 0, 'PENDING', NULL, NULL, '20000000-0000-4000-8000-0000000005b1', NULL, '2026-10-06T10:00:00Z', '2026-10-06T10:00:00Z', NULL);

-- expenses, settings, audit ----------------------------------------------------------------------
INSERT INTO expenses (id, type_id, description, amount_paisa, expense_date, vehicle_id, driver_id, recorded_by_user_id, created_at, updated_at)
SELECT '20000000-0000-4000-8000-0000000ee001', t.id, 'Diesel', 500000, '2026-10-04', '20000000-0000-4000-8000-0000000000f1',
       '20000000-0000-4000-8000-00000000e001', '20000000-0000-4000-8000-0000000000a1', '2026-10-04T12:00:00Z', '2026-10-04T12:00:00Z'
FROM expense_types t WHERE t.code = 'PETROL';

INSERT INTO app_settings (key, scope, value, updated_by_user_id, created_at, updated_at) VALUES
 ('support.phone', 'global', '"0300 1112222"', '20000000-0000-4000-8000-0000000000a1', '2026-10-01T09:00:00Z', '2026-10-01T09:00:00Z');

INSERT INTO audit_logs (id, actor_kind, actor_user_id, action, resource_type, resource_id, distributor_id, diff, created_at) VALUES
 ('20000000-0000-4000-8000-00000000ad01', 'USER', '20000000-0000-4000-8000-000000000da1', 'refill.cancel', 'refill',
  '20000000-0000-4000-8000-0000000fd003', '20000000-0000-4000-8000-00000000da00', '{"reason":"Not needed"}', '2026-10-04T12:00:00Z');
