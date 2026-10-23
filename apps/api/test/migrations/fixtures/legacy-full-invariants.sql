-- The database sub-lane's post-inc1a checks on legacy-full.sql (DATA_MODEL §3.8 invariants and each
-- backfill's own result), one row { name, ok } per check.
WITH checks(name, ok) AS (VALUES
 -- DATA_MODEL invariants
 ('every distributor has a valid code',
   NOT EXISTS (SELECT 1 FROM distributors WHERE code IS NULL OR code !~ '^[A-Z][A-Z0-9]{1,5}$')),
 ('distributor codes are D01..D06 by created_at',
   (SELECT string_agg(code, ',' ORDER BY created_at) FROM distributors) = 'D01,D02,D03,D04,D05,D06'),
 ('every distributor has counters >= 1',
   NOT EXISTS (SELECT 1 FROM distributors WHERE next_order_no < 1 OR next_topup_no < 1 OR next_refill_no < 1 OR next_cylinder_no < 1)),
 ('ledger sum = cached balance for every distributor',
   NOT EXISTS (SELECT 1 FROM distributors d LEFT JOIN ledger_entries l ON l.distributor_id = d.id
               GROUP BY d.id HAVING d.advance_balance_paisa <> COALESCE(sum(l.amount_paisa), 0))),
 ('every expense has a type_id', NOT EXISTS (SELECT 1 FROM expenses WHERE type_id IS NULL)),
 ('phones are E.164 or flagged',
   NOT EXISTS (SELECT 1 FROM clients c WHERE c.phone !~ '^\+923[0-9]{9}$'
               AND NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.action = 'client.phone_needs_fix' AND a.resource_id = c.id))),
 ('the six seeded expense types exist',
   (SELECT count(*) FROM expense_types WHERE code IN ('PETROL','MAINTENANCE','REPAIRS','TYRES','TOLL_PARKING','OTHER') AND archived_at IS NULL) = 6),
 -- each backfill on this data
 ('order numbers 1..n per distributor, counter = max + 1',
   NOT EXISTS (SELECT 1 FROM (SELECT distributor_id, count(*) n, max(order_no) mx, count(DISTINCT order_no) dn FROM orders GROUP BY distributor_id) x
               JOIN distributors d ON d.id = x.distributor_id WHERE x.mx <> x.n OR x.dn <> x.n OR d.next_order_no <> x.mx + 1)
   AND NOT EXISTS (SELECT 1 FROM distributors d WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.distributor_id = d.id) AND d.next_order_no <> 1)),
 ('PAID_VIA_LEDGER orders are DEDUCTED / LEGACY_ZONE_PAIR, others NONE',
   NOT EXISTS (SELECT 1 FROM orders WHERE (payment_status = 'PAID_VIA_LEDGER') <> (fee_status = 'DEDUCTED'))
   AND NOT EXISTS (SELECT 1 FROM orders WHERE fee_status = 'DEDUCTED' AND fee_strategy IS DISTINCT FROM 'LEGACY_ZONE_PAIR')
   AND NOT EXISTS (SELECT 1 FROM orders WHERE fee_status = 'NONE' AND fee_strategy IS NOT NULL)),
 ('delivered_at = first DEBIT_ORDER time, else updated_at; DRIVER_TAP',
   NOT EXISTS (SELECT 1 FROM orders o WHERE o.status = 'DELIVERED' AND (o.delivery_method IS DISTINCT FROM 'DRIVER_TAP' OR o.delivered_at IS DISTINCT FROM
               COALESCE((SELECT min(created_at) FROM ledger_entries l WHERE l.order_id = o.id AND l.entry_type = 'DEBIT_ORDER'), o.updated_at)))
   AND NOT EXISTS (SELECT 1 FROM orders WHERE status <> 'DELIVERED' AND delivered_at IS NOT NULL)),
 ('cancelled_at / failed_at = updated_at; assigned_at = trip planned_at',
   NOT EXISTS (SELECT 1 FROM orders WHERE (status = 'CANCELLED') <> (cancelled_at IS NOT NULL) OR (status = 'FAILED') <> (failed_at IS NOT NULL))
   AND NOT EXISTS (SELECT 1 FROM orders WHERE status = 'CANCELLED' AND cancelled_at <> updated_at)
   AND NOT EXISTS (SELECT 1 FROM orders WHERE status = 'FAILED' AND failed_at <> updated_at)
   AND NOT EXISTS (SELECT 1 FROM orders o LEFT JOIN trips t ON t.id = o.trip_id WHERE o.assigned_at IS DISTINCT FROM t.planned_at)),
 ('payment placeholders NULLed, real gateway ids kept',
   (SELECT count(*) FROM payments WHERE provider_txn_id IS NULL) = 5
   AND (SELECT provider_txn_id FROM payments WHERE id = '00000000-0000-0000-0000-0000000fa001') = 'EP-TXN-0001'),
 ('request numbers 1..n per distributor, top-up counter = max + 1',
   NOT EXISTS (SELECT 1 FROM (SELECT distributor_id, count(*) n, max(request_no) mx, count(DISTINCT request_no) dn FROM payments GROUP BY distributor_id) x
               JOIN distributors d ON d.id = x.distributor_id WHERE x.mx <> x.n OR x.dn <> x.n OR d.next_topup_no <> x.mx + 1)
   AND NOT EXISTS (SELECT 1 FROM distributors d WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.distributor_id = d.id) AND d.next_topup_no <> 1)),
 ('old ledger rows keyed legacy:<id>',
   NOT EXISTS (SELECT 1 FROM ledger_entries WHERE reason_code IS NULL AND idempotency_key IS DISTINCT FROM 'legacy:' || id::text)),
 ('old refill debits linked to their refill',
   (SELECT filling_order_id FROM ledger_entries WHERE id = '00000000-0000-0000-0000-0000000fb004') = 'f1f1f1f1-0000-0000-0000-000000000001'
   AND (SELECT filling_order_id FROM ledger_entries WHERE id = '00000000-0000-0000-0000-0000000fb007') = 'f2f2f2f2-0000-0000-0000-000000000002'
   AND (SELECT count(*) FROM ledger_entries WHERE filling_order_id IS NOT NULL) = 2),
 ('opening entries only where history was missing: DB +3,000,000 and DD +235,000',
   (SELECT string_agg(d.code || ':' || l.amount_paisa, ',' ORDER BY d.code) FROM ledger_entries l JOIN distributors d ON d.id = l.distributor_id
     WHERE l.reason_code = 'OPENING_BALANCE' AND l.entry_type = 'ADJUSTMENT' AND l.idempotency_key = 'opening:' || l.distributor_id::text
       AND l.balance_after_paisa = d.advance_balance_paisa) = 'D02:3000000,D04:235000'),
 ('one SYSTEM wallet.opening_entry audit row per opening entry',
   (SELECT count(*) FROM audit_logs WHERE action = 'wallet.opening_entry' AND actor_kind = 'SYSTEM' AND actor_user_id IS NULL
      AND actor_label = 'migration:inc1a' AND diff ? 'ledgerEntryId' AND jsonb_typeof(diff->'amountPaisa') = 'string') = 2),
 ('pickup stops linked to the trip store',
   NOT EXISTS (SELECT 1 FROM trip_stops ts JOIN trips t ON t.id = ts.trip_id WHERE ts.stop_type = 'STORE_PICKUP' AND ts.store_id IS DISTINCT FROM t.origin_store_id)),
 ('stop statuses from timestamps',
   (SELECT string_agg(right(id::text, 4) || '=' || status, ',' ORDER BY id) FROM trip_stops)
     = 'c101=DONE,c102=DONE,c103=DONE,c201=ARRIVED,c202=PENDING,c301=CANCELLED,c302=CANCELLED'),
 ('address zones: smallest covering active zone, border to oldest, NULL outside/inactive',
   (SELECT string_agg(right(ca.id::text, 4) || '=' || COALESCE(z.name, '-'), ',' ORDER BY ca.id) FROM client_addresses ca LEFT JOIN zones z ON z.id = ca.zone_id)
     = 'ca01=F-7 Markaz,ca02=F-Sectors,ca03=G-Sectors,ca04=F-Sectors,ca05=-,ca06=-'),
 ('phones normalised where unambiguous',
   (SELECT string_agg(right(id::text, 4) || '=' || phone, ',' ORDER BY id) FROM clients)
     = '0001=+923001234567,0002=+923012345678,0003=+923023456789,0004=+923031234567,0005=051 1234567,0006=+923041234567,0007=call shop,0008=+923001234567'),
 ('exactly one phone_needs_fix row per bad phone (2)',
   (SELECT count(*) FROM audit_logs WHERE action = 'client.phone_needs_fix' AND actor_kind = 'SYSTEM' AND actor_label = 'migration:inc1a') = 2
   AND (SELECT count(DISTINCT resource_id) FROM audit_logs WHERE action = 'client.phone_needs_fix') = 2),
 ('old categories mapped: FUEL->PETROL, MAINTENANCE, OTHER, archived LEGACY_*',
   (SELECT string_agg(e.category::text || '>' || t.code, ',' ORDER BY e.id) FROM expenses e JOIN expense_types t ON t.id = e.type_id)
     = 'FUEL>PETROL,MAINTENANCE>MAINTENANCE,OTHER>OTHER,FOOD>LEGACY_FOOD,UTILITIES>LEGACY_UTILITIES,RENT>LEGACY_RENT,FOOD>LEGACY_FOOD'
   AND NOT EXISTS (SELECT 1 FROM expense_types WHERE code LIKE 'LEGACY_%' AND archived_at IS NULL)
   AND (SELECT string_agg(name, ',' ORDER BY code) FROM expense_types WHERE code LIKE 'LEGACY_%') = 'Food,Rent,Utilities'),
 ('old USER audit rows kept their actor', (SELECT actor_kind::text FROM audit_logs WHERE id = '00000000-0000-0000-0000-0000000ad001') = 'USER'),
 ('all 12 CHECK constraints present',
   (SELECT count(*) FROM pg_constraint WHERE contype = 'c' AND conname IN ('dzp_base_chk','dzps_amount_chk','distributors_code_chk','distributors_counters_chk',
     'audit_logs_actor_chk','stored_files_size_chk','expense_types_name_chk','expenses_void_chk','orders_fee_chk','order_lines_counts_chk',
     'payments_amount_chk','expenses_amount_chk')) = 12),
 ('the 4 old-table CHECKs are NOT VALID, the rest validated',
   (SELECT count(*) FROM pg_constraint WHERE contype = 'c' AND NOT convalidated AND conname IN ('orders_fee_chk','order_lines_counts_chk','payments_amount_chk','expenses_amount_chk')) = 4
   AND (SELECT count(*) FROM pg_constraint WHERE contype = 'c' AND NOT convalidated AND connamespace = 'public'::regnamespace) = 4)
)
SELECT name, ok FROM checks
