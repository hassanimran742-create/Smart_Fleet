# LPG Smart Fleet — Test Plan

Companion to `docs/Smart_Fleet_Test_Plan.xlsx`. The Excel workbook is the
source of truth for individual test cases; this document explains the
**strategy, coverage map, and how to run each layer**.

## 1. Scope

| Area | What we test |
|---|---|
| **Admin Portal** | Driver / Inventory / Store / Zone / Vehicle / Expense CRUD; Sector assignment; Availability toggles; Analytics (orders, km, fuel, in-progress, cost-per-cylinder) |
| **Distributor** | Add/remove client, balance view + top-up, current/pending orders, inventory status |
| **Driver** | Current / pending / assigned orders; pickup; OTP-verified delivery dispatch |
| **Data seeding** | Deterministic fixtures for admin, zones, stores, cylinders, drivers, distributors, customers |
| **E2E simulation** | Happy path + drop-out scenarios + concurrency + stock exhaustion |
| **Algorithm** | Dispatch scoring unit + property tests with worked examples |
| **Inventory tracking** | Conservation, audit completeness, ledger sums, cost-per-cylinder math, audit immutability |
| **Unit automation** | Jest specs per service + e2e per feature |
| **Deployment** | docker-compose health, migrations, seed, TLS, backup/restore, rolling deploy |

## 2. Totals (132 test cases)

| Module | Count | P0 | P1 | P2 |
|---|---|---|---|---|
| Admin – Driver | 10 | 6 | 4 | 0 |
| Admin – Inventory | 9 | 7 | 2 | 0 |
| Admin – Store | 8 | 5 | 2 | 1 |
| Admin – Zone | 9 | 6 | 3 | 0 |
| Admin – Vehicle | 6 | 6 | 0 | 0 |
| Admin – Expense | 10 | 4 | 5 | 1 |
| Admin – Availability | 3 | 2 | 1 | 0 |
| Admin – Analytics | 10 | 10 | 0 | 0 |
| Distributor | 11 | 11 | 0 | 0 |
| Driver | 9 | 8 | 1 | 0 |
| Data Seeding | 8 | 8 | 0 | 0 |
| E2E Simulation | 8 | 5 | 3 | 0 |
| Algorithm | 7 | 6 | 1 | 0 |
| Inventory Tracking | 6 | 6 | 0 | 0 |
| Unit Automation | 9 | 9 | 0 | 0 |
| Deployment | 9 | 6 | 3 | 0 |

(See `Smart_Fleet_Test_Plan.xlsx → Summary` for the live table.)

## 3. Test pyramid & ownership

| Layer | Where it runs | Owner | Speed | Goal |
|---|---|---|---|---|
| **Unit** (Jest, mocked deps) | `apps/api/src/**/*.spec.ts` | Backend | <100 ms/test | Service logic, state machines, **algorithm weights** |
| **Integration** (Jest + Testcontainers Postgres+PostGIS) | `apps/api/test/integration/*.spec.ts` | Backend | a few seconds | Repository + service over a real DB |
| **E2E API** (Jest + real stack via docker-compose) | `apps/api/test/e2e/*.spec.ts` | Backend | ~30s/spec | HTTP contract, role guards, full order lifecycle |
| **Property** (`fast-check`) | `apps/api/test/property/*.spec.ts` | Backend | a few seconds | Invariants of scoring & inventory conservation |
| **Load** (`k6`) | `infrastructure/load/*.js` | Backend / DevOps | minutes | Concurrency budget |
| **Mobile** (Detox or manual) | `apps/mobile/test/` | Mobile | minutes | Customer/Distributor/Driver flows in app shell |
| **Deployment** (operational) | Staging VPS | DevOps | minutes | docker-compose, migrations, TLS, backup/restore |

## 4. Test environments

- **Dev** — local docker-compose, mocks everywhere.
- **CI** — GitHub Actions; spins ephemeral Postgres+PostGIS and Redis;
  runs Unit + Integration + E2E + Property + Coverage.
- **Staging** — single VPS mirror of prod; used for TC-127, 128, 130, 131
  before any release.
- **Production** — smoke tests only (TC-132 health/ready, TC-094 happy path
  on a known test phone).

## 5. Data seeding (Wave 0)

Every test layer uses the same factory in `packages/shared-utils/test-fixtures/`:

```ts
seed({
  admin: 1,
  zones: ['Clifton', 'Defence', 'Gulshan'],
  stores: 2,
  cylinders: { 11: 30, 45: 20 },
  drivers: 2,
  distributors: 1,
  customers: 5,
})
```

This same factory powers `npm run seed` in dev and the `beforeAll()` of
e2e specs. **TC-086 to TC-093** verify each piece.

## 6. Algorithm evaluation (the heart of the product)

Tested at three levels:

1. **Unit** — `dispatch.service.spec.ts` (TC-102, 104, 106, 107, 108)
   - One test per scoring weight verifies the exact delta.
   - Worked example (TC-106): driver 2 km from store, store→client 3 km,
     loaded 4/10, same zone → `100 - 8 - 9 - 6 + 15 = 92`.
2. **Property** — `dispatch.property-spec.ts` (TC-103, 105)
   - `fast-check` generates random drivers/orders; the assertion is the
     invariant: *closer driver scores higher when all else equal*; *empty
     store is never selected when a stocked one is reachable*.
3. **E2E** — TC-094, 095, 100, 101 exercise it through the real BullMQ
   processor.

## 7. Inventory & expense tracking scenarios

The aim is mathematical correctness, not behavior.

| ID | Scenario | Invariant |
|---|---|---|
| TC-109 | A→B move 3 cylinders | `count(A_before) + count(B_before) = count(A_after) + count(B_after)` |
| TC-110 | Full lifecycle | One `stock_movement` row per state transition |
| TC-111 | 3 fuel entries | `sum(liters) = totalLiters` reported by analytics |
| TC-112 | Mixed expenses | `fuel + maint + meal + other = total` reported per vehicle |
| TC-113 | Cost-per-cylinder | `total_cost / cylinders_delivered = displayed_value` (HALF_UP, 2dp) |
| TC-114 | Audit immutability | DELETE on `order_events`/`stock_movements` rejected at trigger level |

## 8. Automating unit test cases — CI pipeline

`.github/workflows/ci.yml` (will be added in Phase 10):

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres: { image: postgis/postgis:15-3.3, ... }
      redis:    { image: redis:7-alpine, ... }
    steps:
      - checkout
      - setup-node@v4 (cache: npm)
      - run: npm ci
      - run: npm run lint
      - run: npm run test -- --coverage
      - run: npm run test:e2e
      - codecov upload
      - run: npm run test:property
```

Coverage gate enforced via `jest.config.ts → coverageThreshold`:

```ts
coverageThreshold: {
  global: { statements: 70, branches: 60 },
  './src/modules/dispatch/dispatch.service.ts': {
    statements: 100, branches: 95
  }
}
```

## 9. Automation phasing (mapped to the project plan)

| Wave | When (per Project Plan) | Test IDs | Outcome |
|---|---|---|---|
| 1 | Day 25 (Phase 10.1) | TC-115..119, TC-102..108 | Unit + algorithm green; coverage gate set |
| 2 | Day 26 (Phase 10.2) | TC-001..085, TC-120..123 | Integration + e2e green |
| 3 | Day 27 (Phase 10.3) | TC-094..101 | Concurrency + load smoke (k6: p95 < 800ms) |
| 4 | Day 29–30 (Phase 12) | TC-114, throttler/security | Security + production hardening signoff |
| 5 | Day 31–32 (Phase 13) | TC-124..132 | Deployment dress rehearsal |

## 10. Deployment-of-application plan (the operational tests)

Live as a separate sheet in the workbook (`Deployment Plan`):

1. **Provision VPS** — `infrastructure/scripts/provision.sh` (Docker + UFW + fail2ban).
2. **Pull repo + .env.prod** from vault.
3. **`docker compose up`** — all services healthy in 60s (TC-124).
4. **Run migrations** — idempotent (TC-125).
5. **Seed** — safe one-time (TC-126).
6. **TLS via Certbot** — valid cert chain (TC-127).
7. **Smoke** — `/healthz`, OTP login, place test order (TC-132 + TC-094).
8. **Baseline backup** — `backup.sh` + offsite copy (TC-129).
9. **Monitoring** — Sentry DSN + UptimeRobot on `/healthz`.
10. **Mobile build** — `eas build --profile production` → Play Console internal.
11. **Signoff** — stakeholder walk-through of TC-094..098 on prod.

## 11. Reporting

- **Per-CI run** — Jest HTML report + Codecov badge in README.
- **Test session ledger** — every Claude session that lands tests appends to
  `docs/test-runs/<date>.md` with: tests added, failures fixed, coverage
  delta, residual risk.
- **Acceptance** — A milestone is "Done" only when all P0 cases for the
  modules in scope are automated **and** green twice in a row in CI.

## 12. Out of scope (for now)

- Penetration testing / OWASP ZAP automation (post-launch).
- Real provider integration tests in CI (would require real credentials).
- Visual regression on mobile (Detox snapshots can come later).
- Chaos engineering on prod (after we have observability).
