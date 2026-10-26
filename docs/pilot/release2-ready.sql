-- Release 2 readiness check (docs/pilot/DEPLOY_RUNBOOK.md, release 2 step 1).
-- Run it on the live database while release 1 still runs, read-only:
--   git -C /srv/smartfleet/src show <release 2 commit>:docs/pilot/release2-ready.sql \
--     | docker run --rm -i postgres:16-alpine psql "<DATABASE_URL without schema=public>" -f -
-- Every row is one thing to sort out first, with today's apps where it says so. "(0 rows)" = ready.
-- The rows are what release 2's migration pre-checks would stop on (inc1a, inc1b, inc2, inc3), plus the
-- open work of the switch-over checklist (API_CONTRACT §8.5 step 3), on the release-1 (af889bf) tables.
SELECT 'Open order: deliver it or cancel it' AS problem, id::text AS id, status::text AS detail
  FROM orders WHERE status NOT IN ('DELIVERED', 'CANCELLED', 'FAILED')
UNION ALL
SELECT 'Run in progress: the driver finishes it', id::text, status::text
  FROM trips WHERE status = 'IN_PROGRESS'
UNION ALL
SELECT 'Refill under way: finish it, or the shop cancels it', id::text, status::text
  FROM filling_orders WHERE status NOT IN ('PENDING', 'COMPLETED', 'CANCELLED', 'FAILED')
UNION ALL
SELECT 'Transfer on the road: finish or cancel it', id::text, status::text
  FROM transfers WHERE status IN ('REQUESTED', 'IN_TRANSIT') AND driver_id IS NOT NULL
UNION ALL
SELECT 'Shop without its own store: create one, set it as the shop''s store', id::text, business_name
  FROM distributors WHERE home_store_id IS NULL
UNION ALL
SELECT 'Store shared by two shops: give each shop its own', home_store_id::text, count(*)::text || ' shops'
  FROM distributors WHERE home_store_id IS NOT NULL GROUP BY home_store_id HAVING count(*) > 1
UNION ALL
SELECT 'Balance below zero: office correction to 0 or more (developer)', id::text, business_name || ': ' || advance_balance_paisa || ' paisa'
  FROM distributors WHERE advance_balance_paisa < 0
UNION ALL
-- The phones as inc1a normalises them (+923XXXXXXXXX where unambiguous), as inc1b compares them.
SELECT 'Two customers of one shop with one phone number: merge or correct them (developer)', distributor_id::text, phone
  FROM (SELECT distributor_id,
               CASE WHEN d ~ '^03[0-9]{9}$'    THEN '+92' || substr(d, 2)
                    WHEN d ~ '^923[0-9]{9}$'   THEN '+' || d
                    WHEN d ~ '^00923[0-9]{9}$' THEN '+' || substr(d, 3)
                    WHEN d ~ '^3[0-9]{9}$'     THEN '+92' || d
                    ELSE raw END AS phone
          FROM (SELECT distributor_id, phone AS raw, regexp_replace(phone, '[^0-9]', '', 'g') AS d FROM clients) c) n
  GROUP BY distributor_id, phone HAVING count(*) > 1
UNION ALL
SELECT 'Shop or driver login without its shop or driver record: suspend it', u.id::text, u.phone || ' ' || u.role
  FROM users u
 WHERE u.status <> 'SUSPENDED'
   AND ((u.role = 'DISTRIBUTOR' AND NOT EXISTS (SELECT 1 FROM distributors d WHERE d.user_id = u.id))
     OR (u.role = 'DRIVER' AND NOT EXISTS (SELECT 1 FROM drivers r WHERE r.user_id = u.id)))
ORDER BY 1, 2;
