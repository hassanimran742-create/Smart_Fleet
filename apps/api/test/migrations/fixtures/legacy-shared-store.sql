-- MIG-008: two distributors share one home store, which inc1a's pre-check must refuse
-- (distributors_home_store_id_key would otherwise fail with a vague error). "Spare Store" is the
-- second shop's own store, used for the fix.

INSERT INTO users (id, phone, name, role, status, password_hash, created_at, updated_at) VALUES
 ('00000000-0000-4000-8000-000000000e01', '+923111112201', 'Shared One', 'DISTRIBUTOR', 'ACTIVE', 'x', '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z'),
 ('00000000-0000-4000-8000-000000000e02', '+923111112202', 'Shared Two', 'DISTRIBUTOR', 'ACTIVE', 'x', '2026-10-02T08:00:00Z', '2026-10-02T08:00:00Z');

INSERT INTO cities (id, name, country_code) VALUES ('00000000-0000-4000-8000-0000000000c2', 'Lahore', 'PK');

INSERT INTO zones (id, city_id, name, polygon, centroid, is_active, created_at, updated_at) VALUES
 ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000c2', 'Old North',
  ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((74.20 31.50, 74.30 31.50, 74.30 31.60, 74.20 31.60, 74.20 31.50)))'), 4326),
  ST_SetSRID(ST_MakePoint(74.25, 31.55), 4326), true, '2026-09-01T08:00:00Z', '2026-09-01T08:00:00Z');

INSERT INTO stores (id, name, zone_id, address, location, is_active, created_at, updated_at) VALUES
 ('00000000-0000-4000-8000-0000000005b1', 'Shared Depot', '00000000-0000-4000-8000-0000000000e2', 'Mall Road', ST_SetSRID(ST_MakePoint(74.22, 31.52), 4326), true, '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z'),
 ('00000000-0000-4000-8000-0000000005b2', 'Spare Store',  '00000000-0000-4000-8000-0000000000e2', 'Jail Road', ST_SetSRID(ST_MakePoint(74.28, 31.52), 4326), true, '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z');

INSERT INTO distributors (id, user_id, business_name, home_store_id, advance_balance_paisa, status, created_at, updated_at) VALUES
 ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-000000000e01', 'Shared One Gas', '00000000-0000-4000-8000-0000000005b1', 0, 'ACTIVE', '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z'),
 ('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-000000000e02', 'Shared Two Gas', '00000000-0000-4000-8000-0000000005b1', 0, 'ACTIVE', '2026-10-02T08:00:00Z', '2026-10-02T08:00:00Z');

INSERT INTO clients (id, distributor_id, name, phone, created_at, updated_at) VALUES
 ('00000000-0000-4000-8000-0000000c1001', '00000000-0000-4000-8000-00000000e001', 'Nadia', '0300 5556677', '2026-10-02T09:00:00Z', '2026-10-02T09:00:00Z');
