# Data model and migrations

This doc owns **every table, column, enum, constraint and migration**. Other docs use these names.

Base: `apps/api/prisma/schema.prisma` at af889bf (1,006 lines). The line references below point there.

## 0. Status of the tested design files

The data-model design was tested end to end: `prisma validate`, `prisma migrate diff`, then `prisma migrate deploy` to a throwaway PostgreSQL 16. The tested files are in the design scratchpad under `dm_handoff/apps/api/prisma/`.

| File | Use it? |
|---|---|
| `migrations/0_baseline/migration.sql` | **Yes, as is.** It was generated from the af889bf schema. Regenerate it once to confirm the output is byte-identical. |
| `migrations/migration_lock.toml` | **Yes, as is.** |
| `scripts/assert-baselined.sql` | **Yes, as is.** |
| `migrations/*_inc1a_*`, `*_inc1b_*`, `*_inc2_*`, `*_inc3_*` | **No.** They encode the superseded hold model. Regenerate them from this doc with the procedure in §2. Copy the SQL blocks marked "unchanged" below. |
| `schema.inc*.prisma` | Reference only. |

Facts the test confirmed, which still apply:
- Each migration file runs as one transaction. If it fails, nothing is applied, and the row stays "failed" until `prisma migrate resolve --rolled-back <name>`.
- A value **added to an existing enum** can't be used in the same file (error 55P04). Values of an enum **created** in the same file can be used.
- Prisma writes GIST indexes from `@@index([...], type: Gist)` and never drops extensions.
- Prisma ignores CHECK constraints, so later diffs never drop them. Prisma does **not** ignore unknown indexes, so use Prisma-expressible indexes only. That is why there are no expression or partial indexes below.

---

## 1. Ground rules

1. **Money**
   - Money is `BigInt` paisa. Ledger amounts are signed: `+` for money in, `−` for money out.
   - JSON carries money as a digit string (main.ts:13-15 patches `BigInt.prototype.toJSON`); a negative amount has a leading ASCII `-` (`"-48000"`, API_CONTRACT §1.1).
2. **One balance per distributor:** `distributors.advance_balance_paisa`.
   - The ledger (`ledger_entries`) is append-only, and its sum equals the balance.
   - No hold tables, no split balance.
3. **Exactly once.** Every money or state write is one of two things:
   - a guarded `UPDATE … WHERE <expected state>`, where zero rows means "already done" or "conflict";
   - an `INSERT` protected by a unique key: `ledger_entries.idempotency_key`, `*.client_request_id`, `payments.bank_reference_key`, `cylinder_events(actor_user_id, client_scan_id)` or `outbound_messages.idempotency_key`.

   The API maps unique-key violations (P2002) using §7.
4. **Codes, not words**
   - Enum columns and `*_reason_code` columns store stable codes. The UI maps each to an i18n key.
   - Free text goes only in `note`, `comment`, `reason` and `*_note` columns.
5. **Actor columns.** `*_by_user_id` are plain UUIDs with no foreign key, matching today's `payments.verified_by_user_id` (:626); NULL means a system job. Only `audit_logs.actor_user_id` and `cylinder_events.actor_user_id` have foreign keys.
6. **Expand, then contract**
   - deploy.sh applies the schema before it restarts the app, so the previous release briefly runs against the new schema (seconds on AWS; on Railway the previous deployment keeps serving until the new one passes its healthcheck).
   - New columns are therefore nullable or defaulted. `NOT NULL`, renames and drops ship one release later.
   - This keeps the previous release starting and writing, not reading everything the new one writes. From inc1a on, the previous code can't read rows that the migration or the new code write: a NULL `provider_txn_id` or `actor_user_id`, a NULL expense category, or new enum values such as `REJECTED` and `CREDIT_ORDER_REVERSAL`. Its lists answer 500. So rolling back past a migration is a forward fix or a restore of the pre-deploy snapshot (§2.6), never just the previous image.
7. **Order progress lives in `OrderStatus` plus timestamps:** `assigned_at`, `load_started_at`, `on_the_way_at`, `delivered_at`, `failed_at`, `cancelled_at`. Money lives in `orders.fee_status`. There is no second progress enum. The UI "stage" is derived (API_CONTRACT §1.4).
8. **Names** keep the existing `snake_case` `@map` style. Give constraints explicit names when Prisma's 63-character limit would make two collide.

---

## 2. Migration strategy and pipeline

### 2.1 Facts today
- There is no `apps/api/prisma/migrations` folder.
- AWS runs `prisma db push --skip-generate` (infrastructure/aws/deploy.sh:39), and so does CI (.github/workflows/ci.yml:59).
- Railway runs `prisma migrate deploy` (railway.toml:9), which applies nothing today.
- The image already ships `apps/api/prisma` (apps/api/Dockerfile:28) with the Prisma CLI.
- Installed versions: `prisma` and `@prisma/client` 5.22.0. Pin both exactly (no caret) for the pilot.
- `apps/api/package.json` already has `prisma:deploy` (= `prisma migrate deploy`). Keep it.

### 2.2 Files to add
```
apps/api/prisma/migrations/migration_lock.toml          provider = "postgresql"   (copy)
apps/api/prisma/migrations/0_baseline/migration.sql     (copy, then verify)
apps/api/prisma/migrations/<UTC ts>_inc1a_foundations/migration.sql
apps/api/prisma/scripts/assert-baselined.sql            (copy)
apps/api/prisma/scripts/migrate.sh
apps/api/scripts/new-migration.mjs
.gitattributes:  apps/api/prisma/migrations/**/*.sql text eol=lf
```
- The inc1b, inc2 and inc3 migrations are added by later releases.
- **Never edit an applied migration.** Fix forward with a new one.
- Write migration files as UTF-8 without BOM, with LF line endings. Prisma checksums each file, and PowerShell `>` adds a BOM, so use `new-migration.mjs`.

### 2.3 Baseline, with no live database
1. Generate the baseline:
   ```
   cd apps/api && npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
   ```
   Run it at the baseline-release commit (schema unchanged from af889bf). The output is 998 lines with 38 tables. It starts with `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`, `"postgis"` and `"uuid-ossp"`.
2. The **baseline release** contains only:
   - `0_baseline`, `migration_lock.toml`, `assert-baselined.sql`;
   - `migrate.sh`, `new-migration.mjs`, `.gitattributes`;
   - the pipeline edits in §2.5.

   It has no schema change.

`prisma/scripts/migrate.sh` is the only path to any database. AWS and Railway both call it.
```sh
#!/bin/sh
set -eu
cd "$(dirname "$0")/.."          # /app/prisma inside the image
DIR=$(pwd)                       # absolute paths: npx runs the CLI from the package root, not from here
SCHEMA="$DIR/schema.prisma"
if ! out=$(npx prisma db execute --schema "$SCHEMA" --file "$DIR/scripts/assert-baselined.sql" 2>&1); then
  case "$out" in *DB_NOT_BASELINED*) ;; *) echo "$out"; exit 1 ;; esac
  if [ "$(ls -d migrations/*/ | wc -l)" -ne 1 ] || [ ! -d migrations/0_baseline ]; then
    echo "DB_NOT_BASELINED: deploy the baseline release first"; exit 1
  fi
  echo "Baseline release: last db push (refuses data loss), drift check, mark 0_baseline applied"
  npx prisma db push --schema "$SCHEMA" --skip-generate
  npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel "$SCHEMA" --exit-code
  npx prisma migrate resolve --schema "$SCHEMA" --applied 0_baseline
fi
npx prisma migrate deploy --schema "$SCHEMA"
```
- `assert-baselined.sql` raises `DB_NOT_BASELINED` when the app's tables exist but no migration has finished: a `db push` database, and also one with an **empty** `_prisma_migrations` table (Railway's old start command ran `migrate deploy` with no migrations folder, which creates that table).
- **On an existing database**, the last `db push` brings live to the baseline whatever commit it was on, and refuses anything destructive. The drift check then proves live equals the baseline before the baseline is marked as applied.
- **On an empty database** (CI, local, new environments), `migrate deploy` simply runs `0_baseline`. That needs PostGIS and a role allowed to `CREATE EXTENSION`. On RDS, create `postgis`, `uuid-ossp` and `pgcrypto` once as the master user.

### 2.4 One migration per change, generated with no database
1. `npm run db:new-migration -- inc1a_foundations`. The script `apps/api/scripts/new-migration.mjs`:
   - writes `git show <base>:apps/api/prisma/schema.prisma` to `.tmp/prev.prisma` (`--base`, default `HEAD`), or, with `--base-file <schema.prisma>`, that file: a second migration on top of one not yet committed, diffed from a snapshot of the first one's schema (as inc2 was diffed from `test/helpers/fixtures/schema.inc1b.prisma`);
   - creates `prisma/migrations/<UTC yyyymmddHHMMSS>_<name>/`;
   - runs `npx prisma migrate diff --from-schema-datamodel .tmp/prev.prisma --to-schema-datamodel prisma/schema.prisma --script`;
   - writes the output as UTF-8 with LF line endings.
2. Hand-edit the file, in this order, with a `--` comment on every hand edit:
   1. **Pre-check** in a `DO $$ … RAISE EXCEPTION 'MIGRATION_BLOCKED <short name>: <what> (<rows>). <fix>, run "prisma migrate resolve --rolled-back <migration name>", then deploy again.'`, where the short name is `inc1a`, `inc1b`… and the migration name is the folder name (for example `20261021195005_inc1a_foundations`), as the built inc1a does.
   2. **The generated DDL, unchanged.** The only exception: split `ADD COLUMN … NOT NULL` into nullable + backfill, and add `SET NOT NULL` in the next release.
   3. **Backfills.** They must be safe to re-run (`WHERE x IS NULL`, `ON CONFLICT DO NOTHING`) and safe on an empty database.
   4. **CHECK constraints.** Use `NOT VALID` on old tables whose existing rows might break them.
3. Review checklist:
   - Is the change additive, with the contract step planned?
   - Are no new values of an existing enum used as literals in the same file?
   - Do the raw INSERTs still work (§6)?
   - Is `packages/shared-types` updated?
   - Is CI green?
   - Did it run on a restored copy of live before prod, with every §3.8 invariant holding?

### 2.5 Pipeline edits
- **infrastructure/aws/deploy.sh** (built) takes a branch, a tag or a full commit SHA (`git fetch origin <ref>`, then a detached checkout of `FETCH_HEAD`). In this order, it stops at the first failure (`set -euo pipefail`):
  1. builds `smartfleet-api:<short sha>` with `--build-arg GIT_COMMIT_SHA=<full sha>` (the commit `GET /health` reports as `version`), or reuses that image when it is still on the host;
  2. checks that `/srv/smartfleet/docker-compose.aws.yml` gives the service its image from `IMAGE_PROD` / `IMAGE_STAGING` (`docker compose config --images`). It then runs the boot preflight (`node dist/common/bootstrap/boot-preflight.js`, API_CONTRACT §3.7) in the new image, with the env file and the container's `NODE_ENV`; an image from before Inc 1 has no preflight and skips it;
  3. on prod, runs `npx prisma migrate status`, then takes an RDS snapshot of `RDS_INSTANCE_ID` (from `/srv/smartfleet/deploy.env`; without it the prod deploy is refused), waits until it is available, and logs it in `/srv/smartfleet/snapshots.log`;
  4. applies the migrations: `docker run --rm --env-file "$ENV_FILE" "smartfleet-api:$SHA" sh prisma/scripts/migrate.sh`;
  5. records the image in `/srv/smartfleet/images.env` and recreates only that service with `docker compose --env-file images.env … up -d --no-deps --force-recreate`;
  6. waits until `GET /api/v1/health` reports the full SHA as `version`.

  Nothing is changed before step 4, so a bad release stops with the database untouched. Operators pass `--env-file images.env` to every compose command (infrastructure/aws/README.md). Earlier `smartfleet-api:<sha>` images stay on the host for a rollback.
- **.github/workflows/ci.yml:57-59.** Replace `db push` with:
  ```yaml
  - name: Apply migrations to a fresh test DB
    working-directory: apps/api
    run: npx prisma migrate deploy
  - name: Migrations match schema.prisma
    working-directory: apps/api
    run: |
      PGPASSWORD=smartfleet_dev psql -h localhost -U smartfleet -d postgres -c 'CREATE DATABASE smartfleet_shadow'
      npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-migrations prisma/migrations \
        --shadow-database-url postgresql://smartfleet:smartfleet_dev@localhost:5432/smartfleet_shadow --exit-code
  ```
  This reuses the `postgis/postgis:16-3.4` service at ci.yml:19. The schema is the FROM side: with `--from-migrations`, Prisma 5.22 ignores the `postgresqlExtensions` preview feature on the shadow side and always reports the three extensions as missing. MIG-001 runs the same command.
- **Workflows** (built): CI runs on pull requests to main and on pushes to every branch.
  - `deploy-staging` resolves its ref to one full SHA, waits for CI's `API — typecheck, lint, test` on that SHA, deploys exactly it, and records the commit status `deploy/staging` on it; its smoke job then checks that commit.
  - `promote-prod` takes only a full 40-character SHA with a green CI check and a successful `deploy/staging` status. After deploying, it waits until the public `GET /api/v1/health` reports that SHA.
- **railway.toml**, only if Railway stays: `startCommand = "if [ -f dist/common/bootstrap/boot-preflight.js ]; then node dist/common/bootstrap/boot-preflight.js; fi && sh prisma/scripts/migrate.sh && node dist/main.js"`. The boot preflight runs first, so a refused env stops the deployment before the migration, and the previous deployment keeps an unchanged database. Railway then needs a PostGIS Postgres.
- **apps/api/package.json scripts**
  - Replace `"prisma:migrate": "prisma migrate dev"` with `"db:new-migration": "node scripts/new-migration.mjs"`.
  - Add `"db:status": "prisma migrate status"` and `"db:drift": "prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code"` (the datasource form reads `DATABASE_URL` itself; Windows cmd doesn't expand `$DATABASE_URL`).
  - Keep `prisma:generate` and `prisma:deploy`.
- **Seeds**
  - `prisma/seed.ts:78-82` creates "Test LPG Shop" without a store. It must also create the store (raw SQL point), `home_store_id` and `code`.
  - `prisma/demo-seed.ts` writes balances directly (:341-375, :957-961) and keyless ledger rows (:881). From inc1a it **refuses to run**, with the message "replaced by the pilot setup script (Inc 3)".
  - `prisma/seed.ts` refuses to run when the deployment is production (`APP_ENV=production`, or `NODE_ENV=production` without `APP_ENV`): it exits 1 with "seed.ts is for development and test servers". Its upserts would otherwise re-activate the seeded logins suspended at the switch-over.

### 2.6 Recovery and rollback
- **`MIGRATION_BLOCKED`:** fix the data the message names, run `npx prisma migrate resolve --rolled-back <migration name>`, then redeploy.
- **Code rollback:** run promote-prod (or `deploy.sh prod <full sha>`) with the earlier commit's full SHA; its `smartfleet-api:<sha>` image is reused when it is still on the host. That alone is a rollback only when no migration ran in between.
  After a migration (from inc1a on), the previous code can't read what the migration and the new code wrote (§1 rule 6). So either fix forward, or restore the pre-deploy snapshot that deploy.sh took (named in `/srv/smartfleet/snapshots.log`) and then deploy the previous SHA.
  On Railway, a deployment that fails its healthcheck after migrating leaves the previous deployment on the migrated database, and the same choice applies.
- **Schema rollback:** never. Write a forward fix, or restore the snapshot or use point-in-time recovery.
- **Separate databases** and separate `_prisma_migrations` are required for staging and prod. Separate Redis key prefixes too: every key the API writes starts with `BULLMQ_PREFIX` (API_CONTRACT §3.7).
- **Backups and the restore drill (pilot targets):** production uses the provider's automated daily backups with point-in-time recovery, kept 7 days, plus the snapshot before every migration deploy (§2.5); staging keeps 3 days. Data loss is at most 5 minutes with point-in-time recovery (24 hours if only daily snapshots exist); the API is back on a restored database within 4 hours. The uploads bucket has versioning on, with old versions kept 30 days. The drill restores the latest backup into a scratch database on the test server, runs `prisma migrate status` and the nightly wallet check, compares counts, opens a stored picture, and records the restore time and the data-loss window. It runs before the Inc 1 switch-over and before the first production deploy of each later increment's migration; a failed drill blocks that deploy.

---

## 3. Increment 1 schema

Two migrations:
- **`inc1a_foundations`** ships with the Inc 1 code.
- **`inc1b_contract`** ships one release later (the first Inc 2 deploy), once only Inc 1 code runs anywhere.

### 3.1 Enums (inc1a)
| Enum | Change |
|---|---|
| `PaymentStatus` (:120) | add `REJECTED` (the super admin said no; legacy BANK_MANUAL rows with `FAILED` are relabelled in inc1b) |
| `LedgerEntryType` (:127) | add `CREDIT_ORDER_REVERSAL` (the cost returned on a cancel before the start) and `DEBIT_REFILL` (reserved for `refill.deliveryCost`, unused while off). Opening balances and corrections stay `ADJUSTMENT` with a `reason_code`. |
| `AlertType` (:730) | add `WALLET_CHECK_MISMATCH` |
| new `OrderFeeStatus` | `NONE` (no cost taken: legacy or zero), `DEDUCTED`, `REVERSED` |
| new `FeeStrategy` | `DISTRIBUTOR_ZONE` (pilot), `LEGACY_ZONE_PAIR` (old orders priced by `PricingRule`) |
| new `DeliveryMethod` | `DRIVER_TAP` (Inc 1 tap), `SCANNED` (Inc 2), `MANUAL` (office, with a reason) |
| new `TripStopStatus` | `PENDING`, `ARRIVED`, `DONE`, `FAILED`, `CANCELLED` |
| new `PayerChannel` | `EASYPAISA_APP`, `BANK_APP`, `OTHER` |
| new `AuditActorKind` | `USER`, `SYSTEM`, `CUSTOMER` |
| new `StoredFilePurpose` | `TOPUP_PROOF`, `EXPENSE_RECEIPT`, `DAY_END_SHEET`, `DAY_END_UPLOAD`, `OTHER` |

`ExpenseCategory` (:956) stays until the post-pilot contract. `Expense.category` becomes nullable.

Reason codes stored as text are TypeScript unions in shared-types. API_CONTRACT §1.5 lists them: `OrderCancelReason`, `DeliveryFailureReason`, `TopupRejectReason`, `CorrectionReason`.

### 3.2 Changed models (inc1a)
| Model | Add / change | Keys and indexes |
|---|---|---|
| `User` (:154) | `tokenVersion Int @default(0) @map("token_version")`, bumped on suspend, archive, role change, a phone change, password change and password reset (API_CONTRACT §3.3) | none |
| `Distributor` (:211) | `code String? @unique` (`^[A-Z][A-Z0-9]{1,5}$`, locked after the first order). `homeStoreId` becomes `@unique` (NOT NULL in 1b). Counters: `nextOrderNo`, `nextTopupNo`, `nextRefillNo` (Inc 3), `nextCylinderNo` (Inc 2), each `Int @default(1)` mapped `next_*_no`. Relations `zonePrices`, `files`. `advanceBalancePaisa` is unchanged: **the** balance. `clientRequestId String? @unique @db.Uuid @map("client_request_id")`: the Idempotency-Key of `POST /distributors`. | `distributors_code_key`, `distributors_home_store_id_key`, `distributors_client_request_id_key` |
| `Store` (:310) | `distributorsAsHome Distributor[]` becomes `distributor Distributor?` (one to one). Add `tripStops TripStop[]`. | `@@index([location], type: Gist)` |
| `Zone` (:289) | relations `zonePrices`, `clientAddresses` | `@@index([polygon], type: Gist)`, `@@index([cityId, isActive])` |
| `Client` (:355) | `clientRequestId String? @db.Uuid @map("client_request_id")`: the Idempotency-Key of `POST /clients` | `@@unique([distributorId, clientRequestId])` (`clients_distributor_id_client_request_id_key`) |
| `ClientAddress` (:380) | `zoneId String?` (the zone that covered the pin when saved, kept for the record; lists, quotes and orders re-check the pin live), `createdAt` | `@@index([clientId])` |
| `CylinderType` (:393) | relation `zonePriceSizes` | none |
| `Order` (:530) | see the table below. `deliveryFeePaisa` (:540) now means **the cost deducted at placement**. `paymentStatus` (:539) is a legacy mirror for old app builds: `PAID_VIA_LEDGER` while DEDUCTED, `UNPAID` otherwise. `cancellationReason` (:544) stays as the free-text cancel note. | `@@unique([distributorId, orderNo])`, `@@unique([distributorId, clientRequestId])`, `@@index([distributorId, createdAt])`, `@@index([tripId])`, `@@index([status, deliveredAt])` |
| `OrderLine` (:564) | `feePerCylinderPaisa BigInt?`, `feePaisa BigInt?` (copy at placement; 0 when the size has no amount) | `@@index([orderId])` |
| `TripStop` (:597) | `storeId String?` (STORE_PICKUP / RETURN_DROPOFF), `status TripStopStatus @default(PENDING)`, `completedAt`, `cancelledAt` | `@@index([orderId])` |
| `Payment` (:618) | see the table below | `@@unique([distributorId, requestNo])`, `@@unique([distributorId, clientRequestId])`, `@@index([status, createdAt])`; `bankReferenceKey @unique`; the existing `@@unique([provider, providerTxnId])` stays |
| `LedgerEntry` (:638) | `idempotencyKey String? @unique` (NOT NULL in 1b), `fillingOrderId String?` (FK, RESTRICT; links old refill debits), `reasonCode String?`, `createdByUserId String?` (NULL = system). `balanceAfterPaisa` = the balance after this row. | `@@index([orderId])`, `@@index([fillingOrderId])` |
| `FillingOrder` (:917) | relation `ledgerEntries` | none |
| `AuditLog` (:699) | `actorUserId` becomes **nullable** (keeps RESTRICT). Add `actorKind AuditActorKind @default(USER)`, `actorLabel String?` (`job:wallet-check`, `migration:inc1a`, `cli:settings`, `link:AG-0142`), `distributorId`, `reason`, `requestId`. | `@@index([distributorId, createdAt])`, `@@index([actorUserId, createdAt])`, `@@index([createdAt])` |
| `Expense` (:969) | see the table below | `@@index([typeId, expenseDate])`, `@@index([vehicleId, expenseDate])`, `@@index([driverId, expenseDate])`; `clientRequestId @unique` |
| `Vehicle`, `Driver` | relation `expenses Expense[]` | none |

New columns on `orders`. All are nullable or defaulted, so the raw INSERT at orders.service.ts:36-57 keeps working until it is rewritten.
```prisma
orderNo              Int?            @map("order_no")              // AG-0142
clientRequestId      String?         @map("client_request_id") @db.Uuid
feeStatus            OrderFeeStatus  @default(NONE) @map("fee_status")
feeStrategy          FeeStrategy?    @map("fee_strategy")
feeBasePaisa         BigInt?         @map("fee_base_paisa")
feeQuotedAt          DateTime?       @map("fee_quoted_at")
feeDetails           Json?           @map("fee_details")           // {zoneId, zoneName, priceId, priceUpdatedAt}; display only
assignedAt           DateTime?       @map("assigned_at")
loadStartedAt        DateTime?       @map("load_started_at")       // first load scan on the order's trip (refund cut-off)
onTheWayAt           DateTime?       @map("on_the_way_at")
deliveredAt          DateTime?       @map("delivered_at")          // written once
deliveredByUserId    String?         @map("delivered_by_user_id") @db.Uuid
deliveryMethod       DeliveryMethod? @map("delivery_method")
manualDeliveryReason String?         @map("manual_delivery_reason")
cancelledAt          DateTime?       @map("cancelled_at")
cancelledByUserId    String?         @map("cancelled_by_user_id") @db.Uuid
cancelReasonCode     String?         @map("cancel_reason_code")
failedAt             DateTime?       @map("failed_at")
failureReasonCode    String?         @map("failure_reason_code")
failureNote          String?         @map("failure_note")
```
New and changed columns on `payments`:
```prisma
providerTxnId     String?        @map("provider_txn_id")     // was required; NULL for BANK_MANUAL (no '' placeholders, payments.service.ts:45-57)
requestNo         Int?           @map("request_no")          // AG-T031
clientRequestId   String?        @map("client_request_id") @db.Uuid
payerName         String?        @map("payer_name")
payerChannel      PayerChannel?  @map("payer_channel")
transactionId     String?        @map("transaction_id")      // as the distributor typed it; not unique
proofFileId       String?        @map("proof_file_id") @db.Uuid   // FK stored_files, RESTRICT; proofUrl kept for old rows
bankReference     String?        @map("bank_reference")      // as the super admin typed it
bankReferenceKey  String?        @unique @map("bank_reference_key") // upper-case A-Z0-9 only; set on approval; used once ever
bankAmountPaisa   BigInt?        @map("bank_amount_paisa")   // the amount credited
bankReceivedAt    DateTime?      @map("bank_received_at")
rejectReasonCode  String?        @map("reject_reason_code")
rejectNote        String?        @map("reject_note")
```
`verifiedByUserId` (:626) and `completedAt` record who reviewed the request and when, for both approve and reject.

New columns on `expenses`:
```prisma
category         ExpenseCategory?                            // was required; dropped after the pilot
typeId           String?   @map("type_id") @db.Uuid           // NOT NULL in 1b
vehicleId        String?   @map("vehicle_id") @db.Uuid
driverId         String?   @map("driver_id") @db.Uuid
receiptFileId    String?   @map("receipt_file_id") @db.Uuid   // FK stored_files, RESTRICT
clientRequestId  String?   @unique @map("client_request_id") @db.Uuid
voidedAt         DateTime? @map("voided_at")
voidedByUserId   String?   @map("voided_by_user_id") @db.Uuid
voidReason       String?   @map("void_reason")
```
- `description` (required) is the expense's **note**. The UI label is "Note".
- `vendor`, `notes` and `receiptUrl` are legacy: kept, never written.

### 3.3 New models (inc1a)
```prisma
model DistributorZonePrice {           // one current row per distributor per zone, edited in place
  id              String   @id @default(uuid()) @db.Uuid
  distributorId   String   @map("distributor_id") @db.Uuid
  zoneId          String   @map("zone_id") @db.Uuid
  basePaisa       BigInt   @map("base_paisa")                 // once per order
  note            String?
  updatedByUserId String?  @map("updated_by_user_id") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  distributor Distributor                @relation(fields: [distributorId], references: [id])
  zone        Zone                       @relation(fields: [zoneId], references: [id])
  sizes       DistributorZonePriceSize[]
  @@unique([distributorId, zoneId])
  @@index([zoneId])
  @@map("distributor_zone_prices")
}
model DistributorZonePriceSize {       // optional; a size with no row costs 0 per cylinder
  id               String @id @default(uuid()) @db.Uuid
  priceId          String @map("price_id") @db.Uuid
  cylinderTypeId   String @map("cylinder_type_id") @db.Uuid
  perCylinderPaisa BigInt @map("per_cylinder_paisa")
  price        DistributorZonePrice @relation(fields: [priceId], references: [id], onDelete: Cascade)
  cylinderType CylinderType         @relation(fields: [cylinderTypeId], references: [id])
  @@unique([priceId, cylinderTypeId])
  @@map("distributor_zone_price_sizes")
}
model AppSetting {                     // code holds typed defaults (registry); a row overrides
  key             String
  scope           String   @default("global")                 // "distributor:<uuid>" later
  value           Json
  updatedByUserId String?  @map("updated_by_user_id") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  @@id([key, scope])
  @@map("app_settings")
}
model StoredFile {                     // written by FilesService.upload (files.service.ts:70-82 stores nothing today)
  id               String            @id @default(uuid()) @db.Uuid
  storageKey       String            @unique @map("storage_key")   // uploads/<UTC yyyy-mm-dd>/<uuid>.<ext>
  purpose          StoredFilePurpose
  mimeType         String            @map("mime_type")
  sizeBytes        Int               @map("size_bytes")
  sha256           String            @db.Char(64)
  originalName     String?           @map("original_name")
  uploadedByUserId String            @map("uploaded_by_user_id") @db.Uuid
  distributorId    String?           @map("distributor_id") @db.Uuid
  createdAt        DateTime          @default(now()) @map("created_at")
  distributor Distributor? @relation(fields: [distributorId], references: [id])
  payments    Payment[]
  expenses    Expense[]
  @@index([uploadedByUserId, sha256])
  @@index([distributorId, purpose, createdAt])
  @@map("stored_files")
}
model ExpenseType {                    // super-admin managed; seeded types have a stable code
  id              String    @id @default(uuid()) @db.Uuid
  code            String?   @unique                           // PETROL, MAINTENANCE, … ; NULL for custom types; never changes
  name            String                                      // shown as typed; renaming allowed
  nameKey         String    @unique @map("name_key")          // lower(trim(name)), inner spaces collapsed: case-insensitive uniqueness
  isSystem        Boolean   @default(false) @map("is_system") // PETROL and OTHER: can't be archived
  sortOrder       Int       @default(100) @map("sort_order")
  archivedAt      DateTime? @map("archived_at")
  createdByUserId String?   @map("created_by_user_id") @db.Uuid
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")
  expenses Expense[]
  @@map("expense_types")
}
```
The order is the record of its cost: `deliveryFeePaisa`, `feeBasePaisa`, the per-line amounts and `feeDetails`. There is no foreign key to the price row, so prices can be edited or removed freely.

### 3.4 inc1a hand edits
**(1) Pre-check.** Block if a `home_store_id` is shared by more than one distributor. Unchanged from the tested file.

**(3) Backfills.** These run in this order. "Unchanged" means copy the block from the tested `dm_handoff` inc1a.

1. **Distributor codes.** `D01, D02…` by `created_at` (block 3b, unchanged).
2. **Order numbers.** `order_no` per distributor by `(created_at, id)` (3c, unchanged).
   - Then `UPDATE distributors d SET next_order_no = COALESCE((SELECT max(order_no) FROM orders o WHERE o.distributor_id = d.id), 0) + 1;`
3. **Fee status for already-charged orders:**
   ```sql
   UPDATE orders SET fee_status = 'DEDUCTED', fee_strategy = 'LEGACY_ZONE_PAIR'
   WHERE payment_status = 'PAID_VIA_LEDGER' AND fee_status = 'NONE';
   ```
   - Other existing orders keep `NONE`: no cost was taken, and none will be.
   - The backfilled `DEDUCTED` orders never refund either: a cancel checks `fee_strategy` (§3.6 Cancel).
   - The switch-over checklist (API_CONTRACT §8.5) asks ops to finish or cancel open orders first.
4. **Timestamps**
   - `delivered_at` = the first `DEBIT_ORDER` time, falling back to `updated_at`, with `delivery_method = 'DRIVER_TAP'`, for DELIVERED orders;
   - `cancelled_at = updated_at` for CANCELLED;
   - `failed_at = updated_at` for FAILED;
   - `assigned_at = trips.planned_at` (3c, unchanged except the added FAILED line).
5. **Payments.** NULL the `''` and self-referencing BANK_MANUAL `provider_txn_id` values, and number `request_no` (3d, unchanged).
   - Then set `next_topup_no = COALESCE(max(request_no), 0) + 1` per distributor.
6. **Ledger.** `idempotency_key = 'legacy:' || id`. Link old refill debits by note (3e, unchanged).
7. **Opening entries.** Where the cached balance differs from the ledger sum (no history, or only part of it), insert one `ADJUSTMENT` of `amount_paisa` = balance − ledger sum (positive or negative, never 0), `balance_after_paisa` = the cached balance, `reason_code 'OPENING_BALANCE'` and key `opening:<distributorId>`, plus an `audit_logs` row (SYSTEM, `migration:inc1a`, action `wallet.opening_entry`) (3f, unchanged). **Ops checks each one against the bank.**
8. **Trip stops.** `store_id` on STORE_PICKUP stops, and `status` from the timestamps (3g, unchanged).
9. **Address zones.** `client_addresses.zone_id`, using the deterministic rule (3h, unchanged):
   `is_active AND ST_Covers(polygon, location) ORDER BY ST_Area(polygon), created_at, id LIMIT 1`.
10. **Customer phones** to `+923XXXXXXXXX`. This moved here from the tested inc2. Copy its block "3c customer phones" with `actor_label 'migration:inc1a'`. Unfixable numbers stay as typed and get an audit row `client.phone_needs_fix`. The SQL removes every non-digit and accepts `03…`, `923…`, `00923…` and `3…`; a stray `0` after 92 and non-ASCII digits are left as typed and flagged, like any other unfixable number.
11. **Expense types and expense rows:**
    ```sql
    INSERT INTO expense_types (id, code, name, name_key, is_system, sort_order, created_at, updated_at) VALUES
      (gen_random_uuid(),'PETROL','Petrol','petrol',true,10,now(),now()),
      (gen_random_uuid(),'MAINTENANCE','Maintenance','maintenance',false,20,now(),now()),
      (gen_random_uuid(),'REPAIRS','Repairs','repairs',false,30,now(),now()),
      (gen_random_uuid(),'TYRES','Tyres','tyres',false,40,now(),now()),
      (gen_random_uuid(),'TOLL_PARKING','Toll/Parking','toll/parking',false,50,now(),now()),
      (gen_random_uuid(),'OTHER','Other','other',true,999,now(),now())
    ON CONFLICT (code) DO NOTHING;
    -- an archived type for each old category still in use, so old rows keep their meaning; its name (e.g. 'Food') stays taken: the office restores the type to use it again
    INSERT INTO expense_types (id, code, name, name_key, is_system, sort_order, archived_at, created_at, updated_at)
    SELECT gen_random_uuid(), 'LEGACY_' || c, initcap(lower(c)), lower(c), false, 900, now(), now(), now()
    FROM (SELECT DISTINCT category::text AS c FROM expenses WHERE category::text NOT IN ('FUEL','MAINTENANCE','OTHER')) x
    ON CONFLICT (code) DO NOTHING;
    UPDATE expenses e SET type_id = t.id FROM expense_types t
    WHERE e.type_id IS NULL AND t.code = CASE e.category::text
      WHEN 'FUEL' THEN 'PETROL' WHEN 'MAINTENANCE' THEN 'MAINTENANCE' WHEN 'OTHER' THEN 'OTHER'
      ELSE 'LEGACY_' || e.category::text END;
    ```

12. **Retired alert rules.** `UPDATE alert_rules SET is_active = false, updated_at = now() WHERE rule_kind = 'DISTRIBUTOR_CREDIT_OVER' AND is_active;` Balances can't go negative, so these rules can never fire. Safe to re-run. If inc1a has already been applied to a shared database, ship this statement in inc1b step 2 instead.

`filling_stations.price_per_cylinder_paisa` is **not** changed. The API ignores it and returns 0 (ADR-16), so the data is kept in case the owner revisits refill money.

**(4) CHECK constraints**
```sql
ALTER TABLE distributor_zone_prices      ADD CONSTRAINT dzp_base_chk    CHECK (base_paisa >= 0);
ALTER TABLE distributor_zone_price_sizes ADD CONSTRAINT dzps_amount_chk CHECK (per_cylinder_paisa >= 0);
ALTER TABLE distributors
  ADD CONSTRAINT distributors_code_chk     CHECK (code IS NULL OR code ~ '^[A-Z][A-Z0-9]{1,5}$'),
  ADD CONSTRAINT distributors_counters_chk CHECK (next_order_no >= 1 AND next_topup_no >= 1
                                                  AND next_refill_no >= 1 AND next_cylinder_no >= 1);
ALTER TABLE audit_logs    ADD CONSTRAINT audit_logs_actor_chk  CHECK ((actor_kind = 'USER') = (actor_user_id IS NOT NULL));
ALTER TABLE stored_files  ADD CONSTRAINT stored_files_size_chk CHECK (size_bytes > 0);
ALTER TABLE expense_types ADD CONSTRAINT expense_types_name_chk CHECK (char_length(btrim(name)) BETWEEN 2 AND 40);
ALTER TABLE expenses      ADD CONSTRAINT expenses_void_chk     CHECK ((voided_at IS NULL) = (void_reason IS NULL));
-- NOT VALID: new and updated rows are checked; old rows are left alone
ALTER TABLE orders      ADD CONSTRAINT orders_fee_chk         CHECK (delivery_fee_paisa >= 0 AND (fee_base_paisa IS NULL OR fee_base_paisa >= 0)) NOT VALID;
ALTER TABLE order_lines ADD CONSTRAINT order_lines_counts_chk CHECK (full_count >= 0 AND expected_return_count >= 0) NOT VALID;
ALTER TABLE payments    ADD CONSTRAINT payments_amount_chk    CHECK (amount_paisa > 0) NOT VALID;
ALTER TABLE expenses    ADD CONSTRAINT expenses_amount_chk    CHECK (amount_paisa > 0) NOT VALID;
```

### 3.5 inc1b_contract (one release after inc1a)
inc1b ships in the first Increment 2 deploy, together with `inc2_driver_flow` (§4.4): `migrate deploy` applies inc1b, then inc2. Before that deploy, finish every run in progress with the Increment 1 apps (the inc2 pre-check). If the inc2 pre-check blocks, inc1b is already committed, and the Increment 1 code runs fine on it; finish the runs and deploy again. (As built 2026-10-23; proven on the inc1a legacy fixture chain.)

1. **Pre-checks**, in this order, each raising `MIGRATION_BLOCKED inc1b` with the fix; the first that fails stops the file. Each message names at most 20 rows, then "and N more", and ends with `run "prisma migrate resolve --rolled-back <folder>", then deploy again.`:
   - distributors without a store: `distributors without a store (<code> <id>, …). Give each of them its store`;
   - negative balances: `distributors with a negative balance (<code> <n> paisa). Fix with a super-admin correction`;
   - duplicate customer phones within one distributor: `customers of one distributor sharing a phone number (<code> <phone> (customers <ids>)). Merge or correct them`.
2. **Re-derive** values the previous release may have written without the new columns, so the `SET NOT NULL`s below can't fail. Every step is safe to run again:
   - `legacy:<id>` keys for any keyless ledger rows;
   - expense `type_id` from `category` (the inc1a CASE). A category first used after inc1a first gets its archived `LEGACY_<CAT>` type; when that name is already taken by an office type, the expense takes that office type;
   - `order_no` for orders where it is NULL, continuing from `GREATEST(highest number, next_order_no − 1)`; the counter then only goes up;
   - `request_no` for payments where it is NULL (likewise, with `next_topup_no`);
   - `code` for distributors where it is NULL: the next free D-number after the highest D-number in use (re-running inc1a's `row_number` scheme could collide with codes set since).
3. Relabel: `UPDATE payments SET status = 'REJECTED' WHERE provider = 'BANK_MANUAL' AND status = 'FAILED';`
4. **Generated DDL**
   - `distributors.home_store_id SET NOT NULL`, with the FK re-added `ON DELETE RESTRICT`;
   - `ledger_entries.idempotency_key SET NOT NULL`;
   - `expenses.type_id SET NOT NULL`;
   - `orders.order_no`, `payments.request_no` and `distributors.code` `SET NOT NULL`;
   - `clients`: `@@index([distributorId, phone])` becomes `@@unique([distributorId, phone])`.
5. **Wallet invariants**
   ```sql
   ALTER TABLE distributors ADD CONSTRAINT distributors_balance_chk CHECK (advance_balance_paisa >= 0);
   ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_sign_chk CHECK (
        (entry_type IN ('CREDIT_TOPUP','CREDIT_ORDER_REVERSAL') AND amount_paisa > 0)
     OR (entry_type IN ('DEBIT_ORDER','DEBIT_REFILL')           AND amount_paisa < 0)
     OR (entry_type = 'ADJUSTMENT'                              AND amount_paisa <> 0)) NOT VALID;
   ```

### 3.6 Write patterns (each is one transaction; `WalletService` owns every money statement)
**Place an order** (API_CONTRACT §7.6)
1. Resolve the zone for the pin (active zones only, `ST_Covers`, deterministic order) and read the `distributor_zone_prices` row with its sizes.
   - No zone: `PRICING_ZONE_NOT_COVERED`. No row: `PRICING_PRICE_NOT_SET`.
2. Compute the cost: `base + Σ(perCylinder(size) × fullCount)`. A missing size row counts as 0.
3. Number the order:
   ```sql
   UPDATE distributors SET next_order_no = next_order_no + 1 WHERE id = $d RETURNING next_order_no - 1 AS no
   ```
   This locks the distributor row for the rest of the transaction.
4. Raw `INSERT INTO orders`. It includes:
   - `order_no`, `client_request_id`, `origin_store_id = home_store_id`;
   - `delivery_fee_paisa = cost`, `fee_base_paisa`, `fee_strategy`, `fee_quoted_at`, `fee_details`;
   - `fee_status` = `'DEDUCTED'`, or `'NONE'` if the cost is 0;
   - `payment_status` = `'PAID_VIA_LEDGER'`, or `'UNPAID'` if the cost is 0.

   Enum parameters need casts, for example `${v}::"OrderFeeStatus"`. Then insert the lines with their per-size amounts.
5. If the cost is above 0, deduct it:
   ```sql
   UPDATE distributors SET advance_balance_paisa = advance_balance_paisa - $f, updated_at = now()
   WHERE id = $d AND status = 'ACTIVE' AND advance_balance_paisa >= $f RETURNING advance_balance_paisa
   ```
   Zero rows means `DISTRIBUTOR_NOT_ACTIVE` or `WALLET_INSUFFICIENT_BALANCE`, and everything rolls back. On success, insert ledger `DEBIT_ORDER`: `−f`, `balance_after` from RETURNING, `order_id`, key `order:<orderId>:debit`.
6. Write the audit row `order.create`.

The Idempotency-Key is looked up before step 1 (API_CONTRACT §4.2), so a retry returns the first order even if it would now be refused. A retry at the same moment hits `orders_distributor_id_client_request_id_key`. The API returns the first order.

**Add a customer** (API_CONTRACT §7.4). Before the transaction: the Idempotency-Key lookup (API_CONTRACT §4.2); normalise the phone; refuse a phone another customer of $d already has (409 `CLIENT_PHONE_EXISTS`); with an address, find the zone and the price (422 on a block code). In one transaction: `SELECT id FROM distributors WHERE id = $d FOR UPDATE`; check the phone again; raw INSERT the client and the address with `zone_id`. From inc1b `clients_distributor_id_phone_key` backs the check (§7). No audit row.

**Cancel** (API_CONTRACT §7.6)
1. `SELECT … FROM orders WHERE id = $o FOR UPDATE`.
2. Decide `started = isDeliveryStarted(order)` under that lock.
3. Guarded update:
   ```sql
   UPDATE orders SET status = 'CANCELLED', cancelled_at = now(), cancelled_by_user_id = $u, cancel_reason_code = $r,
     cancellation_reason = $note WHERE id = $o AND status IN ('PENDING','CONFIRMED','ASSIGNED','IN_TRANSIT')
   ```
   Zero rows means a repeat or a terminal status.
4. If `!started AND fee_status = 'DEDUCTED' AND fee_strategy <> 'LEGACY_ZONE_PAIR'`:
   1. `UPDATE orders SET fee_status = 'REVERSED', payment_status = 'UNPAID' WHERE id = $o AND fee_status = 'DEDUCTED'`
   2. `UPDATE distributors SET advance_balance_paisa = advance_balance_paisa + $f RETURNING …`
   3. Ledger `CREDIT_ORDER_REVERSAL`: `+f`, key `order:<orderId>:reversal`.
5. Mark the order's trip stop `CANCELLED`. ABORT the trip if it has no other open order and no cylinder event other than a hand-back (SCAN_IN). A SCAN_IN of empties left on the van from an earlier run doesn't keep it open.
6. Write the audit row `order.cancel` with `{refunded, refundPaisa, startedRule}`.

**The first load scan on a trip** (Inc 1 legacy SCAN_OUT; Inc 2 LOAD). Only a load runs this: an event with `trip_id` at the trip's STORE_PICKUP stop. A refill pickup (Inc 3: SCAN_OUT with `filling_order_id` and no `trip_id`) never touches orders. This runs in the scan's transaction:
```sql
SELECT id FROM orders WHERE trip_id = $t FOR UPDATE;
UPDATE orders SET load_started_at = now() WHERE trip_id = $t AND load_started_at IS NULL
  AND status IN ('PENDING','CONFIRMED','ASSIGNED','IN_TRANSIT');
```
The cancel and the scan lock the same order rows, so a refund and a load can never both win. Every order transition (cancel, fail, the Delivered tap, manual delivery) takes the same `FOR UPDATE` lock on the order row first.

**Approve a top-up**
1. Guarded update:
   ```sql
   UPDATE payments SET status = 'SUCCESS', bank_reference = $ref, bank_reference_key = $key, bank_amount_paisa = $a,
     bank_received_at = $t, verified_by_user_id = $u, completed_at = now() WHERE id = $p AND status = 'PENDING'
   ```
   - Zero rows: already decided.
   - P2002 on `payments_bank_reference_key_key`: `TOPUP_BANK_REFERENCE_USED`.
2. `UPDATE distributors SET advance_balance_paisa = advance_balance_paisa + $a RETURNING …`
3. Ledger `CREDIT_TOPUP`: `+a`, `payment_id`, key `topup:<paymentId>`.
4. Write the audit row.

Reject: `UPDATE payments SET status = 'REJECTED', reject_reason_code, reject_note, verified_by_user_id, completed_at WHERE id = $p AND status = 'PENDING'`.

**Correction** (super admin)
- First look up ledger key `adjust:<Idempotency-Key>`. If it exists, compare its distributor, direction (the amount's sign), amount, `reason_code`, `note`, `payment_id` and `order_id` with the request: all equal returns that row (a replay, 200 with `Idempotent-Replay`); any difference gives 409 `IDEMPOTENCY_CONFLICT`. A concurrent duplicate fails on `ledger_entries_idempotency_key_key`; its whole transaction, balance update included, rolls back and it is answered as the replay.
- `TAKE`: `UPDATE distributors SET advance_balance_paisa = advance_balance_paisa - $a WHERE id = $d AND advance_balance_paisa >= $a`. Zero rows: `WALLET_ADJUST_EXCEEDS_BALANCE`.
- `ADD`: `+ $a`.
- Ledger `ADJUSTMENT`, signed, with `reason_code`, `note`, `created_by_user_id`, key `adjust:<Idempotency-Key>`, and `payment_id` / `order_id` set to the related payment or order when given (tracing only; both must belong to the distributor). No cap check, and no distributor status check (API_CONTRACT §5.4).
- Audit `wallet.correction`.

**Expense create, edit and void.** Plain inserts and updates on `expenses` with an audit row. Never touches `distributors` or `ledger_entries`.

**Nightly wallet check**
```sql
SELECT d.id, d.advance_balance_paisa, COALESCE(sum(l.amount_paisa),0) AS ledger
FROM distributors d LEFT JOIN ledger_entries l ON l.distributor_id = d.id GROUP BY d.id
HAVING d.advance_balance_paisa <> COALESCE(sum(l.amount_paisa),0) OR d.advance_balance_paisa < 0
```
Any row raises alert `WALLET_CHECK_MISMATCH` (CRITICAL, deduplicated per distributor). Its context has `differencePaisa = advance_balance_paisa − ledger sum` (signed). "Deduplicated" means no new alert while that distributor already has an OPEN or ACKNOWLEDGED one. The job never resolves alerts and never changes data. Every run then writes one `audit_logs` row `wallet.check` (SYSTEM, `job:wallet-check`, resource_type `job`) with `{checked, mismatches, distributorIds}`.

### 3.7 Code that must change with this schema (owner lane in brackets)
- **orders.service.ts** [api-orders]
  - the raw INSERT at :36-57 hard-codes fee 0 and `UNPAID`;
  - the fee is computed at delivery (:147-192);
  - the store falls back to the oldest one (:233-244);
  - the trip is never closed on reassignment (:246-295).
- **pricing.service.ts:63-80** adds the base once per line (:77). It is replaced by the `DISTRIBUTOR_ZONE` strategy; `PricingRule` (:508) is frozen as legacy: kept and writable through the office's legacy routes, never read by quotes or orders. [api-orders]
- **ledger.service.ts:22-40** (`debitForOrder`) and **payments.service.ts:127-164** (unguarded verify, read-modify-write credit) are deleted, and `WalletService` takes over. [api-money]
- **filling-orders.service.ts:46-58** (balance check) and **:205-236** (`complete()` debit) are removed: no refill money. [api-orders]
- **audit-log.service.ts:8-18** `record()` gains `actorKind` and a transaction parameter; it has no callers today. [foundation]
- **files.service.ts:70-82** writes a `StoredFile` row, and the public bucket policy (:47-63) is removed. [foundation]
- **alert-rules.service.ts:89-118** retires the `DISTRIBUTOR_CREDIT_OVER` kind, because balances can't go negative: it never evaluates that kind, and creating one or setting one active gives `VALIDATION_FAILED`; backfill 12 deactivates the existing ones. [api-security]
- **expenses.service.ts** create and update take `body: any` (expenses.controller.ts:33-41), update spreads the raw body (:70-82), and delete is a hard delete (:84-86). [expenses]
- Admin web and mobile money displays follow UX_ADMIN and UX_MOBILE.

### 3.8 Post-migration invariants
What the MIG tests assert by number, and what ops re-checks on a restored copy of live before the prod deploy (§2.4). Each holds on a migrated copy of live and on an empty database.

**After inc1a**
1. Every distributor has a unique `code` matching `^[A-Z][A-Z0-9]{1,5}$`; old rows are D01, D02… by (`created_at`, `id`).
2. Per distributor, `next_order_no` = max(`order_no`) + 1 and `next_topup_no` = max(`request_no`) + 1 (1 when none); `next_refill_no` = `next_cylinder_no` = 1.
3. Every order has an `order_no` and every payment a `request_no`, numbered 1…n per distributor by (`created_at`, `id`), with no gaps or repeats.
4. For every distributor, `advance_balance_paisa` = Σ `ledger_entries.amount_paisa`. Each `OPENING_BALANCE` row has amount = balance − the old ledger sum (never 0), `balance_after_paisa` = the balance, key `opening:<distributorId>`, and exactly one `wallet.opening_entry` audit row (SYSTEM, `migration:inc1a`); a distributor whose history already added up has none.
5. Every ledger row has an `idempotency_key`; old rows use `legacy:<id>`.
6. Orders with `payment_status = 'PAID_VIA_LEDGER'` have `fee_status = 'DEDUCTED'` and `fee_strategy = 'LEGACY_ZONE_PAIR'`; every other old order has `fee_status = 'NONE'`.
7. DELIVERED orders have `delivered_at` and `delivery_method = 'DRIVER_TAP'`, CANCELLED orders `cancelled_at`, FAILED orders `failed_at`, and orders on a trip `assigned_at`.
8. No payment has `provider_txn_id = ''`, and no BANK_MANUAL payment has one equal to its own id.
9. Every STORE_PICKUP stop has `store_id`, and every stop's `status` follows backfill 8.
10. Every client address covered by an active zone has that zone's `zone_id` (the §6.6 rule).
11. Every client phone matches `^\+923[0-9]{9}$`, or the client has exactly one `client.phone_needs_fix` audit row.
12. The six seeded expense types exist (PETROL and OTHER `is_system`), each other old category in use has one archived `LEGACY_<CATEGORY>` type, and no expense has a NULL `type_id`.
13. No `DISTRIBUTOR_CREDIT_OVER` alert rule is active (backfill 12).
14. The §3.4 (4) CHECK constraints exist.
15. Running the backfill section again changes no value and adds no row (no second opening entry or audit row).
16. With two distributors sharing a home store, the pre-check stops the file with `MIGRATION_BLOCKED inc1a: …` and nothing is applied.

**After inc1b**
17. `distributors.home_store_id`, `distributors.code`, `ledger_entries.idempotency_key`, `expenses.type_id`, `orders.order_no` and `payments.request_no` are NOT NULL, and `clients (distributor_id, phone)` is unique.
18. `distributors_balance_chk` and `ledger_entries_sign_chk` exist, and no balance is below 0.
19. No BANK_MANUAL payment has status FAILED.
20. Each pre-check (a distributor without a store, a negative balance, duplicate customer phones) stops the file with `MIGRATION_BLOCKED inc1b: …` naming the rows and the fix. The checks run in that order and the first that fails stops the file, so the next problem shows on the next run; nothing is applied.

---

## 4. Increment 2 schema (`inc2_driver_flow`)

### 4.1 Enums
| Enum | Change |
|---|---|
| `CylinderState` (:40) | add `PART_FILLED` |
| `CylinderEventType` (:54) | add `REGISTERED` |
| `AlertType` | add `CUSTOMER_PROBLEM` (one case type; the answer is in `context`) and `VAN_NOT_EMPTY` |
| new `CylinderEventSource` | `SCAN`, `TYPED` (cylinder number typed in, logged), `MANUAL` (office, reason required), `REGISTRATION` |
| new `StopCylinderDirection` | `GIVEN`, `TAKEN_BACK` |
| new `ConfirmationStatus` | `PENDING`, `ANSWERED`, `EXPIRED`, `CANCELLED` (reserved: nothing writes it in the pilot) |
| new `ConfirmationResponse` | `YES`, `PARTLY`, `NO`, `OTHER` |
| new `MessageChannel` | `SMS`, `WHATSAPP`, `SHARE_LINK` |
| new `MessageStatus` | `QUEUED`, `SENT`, `DELIVERED`, `FAILED`, `SKIPPED` (mock provider or test mode) |

`CustodyType.DISTRIBUTOR` and `RETURNED_TO_DISTRIBUTOR` stay in the enum, but nothing new writes them. The EMPTY-to-FULL laundering in custody.service.ts:37 is removed.

### 4.2 Changed models
| Model | Change |
|---|---|
| `Cylinder` (:408) | `shortNo Int? @map("short_no")` with `@@unique([distributorId, shortNo])`; shown `AG-C0042` (`formatNo(code, 'CYLINDER', shortNo)`) and typed `42`, `0042`, `C0042` or `AG-C0042` in any letter case (`parseCylinderNo`, API_CONTRACT §1.1). `lastEventId String? @unique` (one-to-one FK to `CylinderEvent`, `onDelete: SetNull`): the last move, giving "loaded on this run" (its `tripId`). The responsible driver is read from `cylinder_events`: the trip's or refill's driver of the newest onto-van event newer than the newest event into a store (API_CONTRACT §9.2), using `@@index([cylinderId, createdAt])`. `@@index([custodyType, custodyId])`. |
| `CylinderEvent` (:429) | `source CylinderEventSource @default(SCAN)`, `fromState` and `toState CylinderState?`, `reason String?`, `clientScanId String? @db.Uuid`, `tripStopId String?` (FK, RESTRICT). `@@unique([actorUserId, clientScanId])`, `@@index([tripId])`, `@@index([orderId])`, `@@index([createdAt])`. |
| `Trip` (:577) | `leftoverReason String?` (5–300 characters; set only by a finish with leftovers while `trip.allowFinishWithLeftovers` is on) |
| `Alert` (:778) | `distributorId String? @db.Uuid` plus `@@index([distributorId, status, createdAt])`, so a distributor sees their own cases. `resolvedByUserId String? @db.Uuid @map("resolved_by_user_id")` (no FK, rule 5) and `resolutionNote String? @db.VarChar(300) @map("resolution_note")`, set by the case resolve (API_CONTRACT §9.6) |
| `Order`, `TripStop`, `CylinderType` | back-relations for the new models |

### 4.3 New models
```prisma
model StopCylinder {                    // the two per-visit lists
  id             String                @id @default(uuid()) @db.Uuid
  tripStopId     String                @map("trip_stop_id") @db.Uuid
  orderId        String                @map("order_id") @db.Uuid
  cylinderId     String                @map("cylinder_id") @db.Uuid
  cylinderTypeId String                @map("cylinder_type_id") @db.Uuid
  direction      StopCylinderDirection
  returnState    CylinderState?        @map("return_state")   // TAKEN_BACK only: EMPTY | PART_FILLED | FULL
  eventId        String                @unique @map("event_id") @db.Uuid
  createdAt      DateTime              @default(now()) @map("created_at")
  @@unique([tripStopId, cylinderId])     // given on a visit can't be taken back on it; no double scans
  @@index([orderId, direction])
  @@index([cylinderId])
  @@map("stop_cylinders")
}
model StopUnlabelledReturn {            // unlabelled or other-brand returns, counted by size and state at the door; they count as taken back but never get a holder; the PUT keeps no row for a count of 0
  id               String        @id @default(uuid()) @db.Uuid
  tripStopId       String        @map("trip_stop_id") @db.Uuid
  orderId          String        @map("order_id") @db.Uuid
  cylinderTypeId   String        @map("cylinder_type_id") @db.Uuid
  state            CylinderState                              // EMPTY | PART_FILLED | FULL
  count            Int
  recordedByUserId String        @map("recorded_by_user_id") @db.Uuid
  updatedAt        DateTime      @updatedAt @map("updated_at")
  @@unique([tripStopId, cylinderTypeId, state])
  @@map("stop_unlabelled_returns")
}
model DeliveryConfirmation {            // one per order; record only (CUSTOMER_PAGE.md)
  id            String                @id @default(uuid()) @db.Uuid
  orderId       String                @unique @map("order_id") @db.Uuid
  distributorId String                @map("distributor_id") @db.Uuid
  tokenHash     String                @unique @map("token_hash") @db.Char(64)  // sha256 hex of the current link token
  tokenVersion  Int                   @default(1) @map("token_version")        // "new link" bumps it
  lastNewLinkKey String?              @map("last_new_link_key") @db.Uuid       // Idempotency-Key of the last new link, for its replay
  status        ConfirmationStatus    @default(PENDING)
  expiresAt     DateTime              @map("expires_at")                       // delivered_at + confirmation.linkTtlHours
  phoneE164     String?               @map("phone_e164")                       // NULL = the customer's number is not a valid mobile; refreshed from the customer on every new link
  snapshot      Json                                                           // what the page shows, frozen at delivery
  response      ConfirmationResponse?
  comment       String?               @db.VarChar(300)
  respondedAt   DateTime?             @map("responded_at")
  createdAt     DateTime              @default(now()) @map("created_at")
  updatedAt     DateTime              @updatedAt @map("updated_at")
  messages OutboundMessage[]
  @@index([status, expiresAt])
  @@index([distributorId, createdAt])
  @@map("delivery_confirmations")
}
model OutboundMessage {                 // every send attempt and every app share
  id                String         @id @default(uuid()) @db.Uuid
  channel           MessageChannel
  provider          String         // mock | eocean | share-whatsapp | share-sms | share-sheet | share-copy
  toPhoneE164       String?        @map("to_phone_e164")
  templateKey       String         @map("template_key")                  // sms.deliveryConfirm.v1
  locale            String         @default("en")
  bodyRedacted      String         @map("body_redacted") @db.VarChar(320) // link token replaced by [link]
  status            MessageStatus  @default(QUEUED)
  providerMessageId String?        @map("provider_message_id")
  errorCode         String?        @map("error_code")                    // MOCK_PROVIDER, NOT_A_TEST_PHONE, INVALID_NUMBER, …
  idempotencyKey    String         @unique @map("idempotency_key")       // confirm:<orderId>:v<n>:sms | share:<orderId>:<Idempotency-Key, or a new uuid>
  confirmationId    String?        @map("confirmation_id") @db.Uuid
  tokenVersion      Int?           @map("token_version")                 // the link version the message carried; reach and lastMessage read only the current one
  orderId           String?        @map("order_id") @db.Uuid
  distributorId     String?        @map("distributor_id") @db.Uuid
  createdByUserId   String?        @map("created_by_user_id") @db.Uuid
  createdAt         DateTime       @default(now()) @map("created_at")
  sentAt            DateTime?      @map("sent_at")
  confirmation DeliveryConfirmation? @relation(fields: [confirmationId], references: [id], onDelete: Restrict)
  @@index([status, createdAt])
  @@index([orderId, createdAt])
  @@map("outbound_messages")
}
```
Add the relations in full (`tripStop`, `order`, `cylinder`, `cylinderType` and `event`, all `onDelete: Restrict`) when writing the schema. As built: `DeliveryConfirmation` also has its `order` relation (`order_id` → `orders`, RESTRICT), as §4.2's "Order back-relations" implies. Because `Cylinder.lastEvent` adds a second relation between `Cylinder` and `CylinderEvent` (named `CylinderLastEvent`), the existing one is named `CylinderEvents`; field names and DDL are unchanged.

### 4.4 inc2 hand edits
- **Pre-check:** block if any trip is `IN_PROGRESS`. A run started under the old rules can't be finished under the new ones. The message, as built: `runs in progress (<tripId> (<plate>), …). Finish each run with the Increment 1 apps first`, naming at most 20 runs and ending like inc1b's (§3.5).
- **Backfills**
  1. `last_event_id` = the newest event per cylinder, only where its `to_custody` matches the current custody. Otherwise leave it NULL; the cylinder must be scanned into the store before it can go out.
  2. `short_no` = `row_number()` per distributor by `created_at`. Then `next_cylinder_no = max + 1`. Labels are reprinted to show the number, written `AG-C0042`.
- **CHECKs**
  - `stop_cylinders_return_state_chk`: `(direction = 'GIVEN' AND return_state IS NULL) OR (direction = 'TAKEN_BACK' AND return_state IS NOT NULL AND return_state::text IN ('EMPTY','PART_FILLED','FULL'))`. The `::text` is needed because PART_FILLED is new in this file. The `IS NOT NULL` is needed because a CHECK passes when its expression is NULL: without it a TAKEN_BACK row with no return state would pass.
  - `cylinder_events_reason_chk`: `source IN ('SCAN','TYPED','REGISTRATION') OR reason IS NOT NULL`.
  - `stop_unlabelled_returns_count_chk`: `count > 0` (the API deletes the row for a count of 0).
  - `delivery_confirmations_answer_chk`: `(status = 'ANSWERED') = (response IS NOT NULL)`.

### 4.5 Write patterns
**Scan**, in one transaction:
1. A resend with the same `(actor, client_scan_id)` returns the recorded scan; a unique-key violation on it at insert is answered the same way.
2. A LOAD locks the trip's order rows first (§3.6). Then lock the cylinder row (`SELECT … FOR UPDATE`). Rows are always locked orders first (by id), then the trip, then the cylinder.
3. Check the rules in API_CONTRACT §9.2, in its order. The same move again under a new scan ID is answered ALREADY_RECORDED and writes nothing.
4. Insert the event with source, custody, states, trip, stop, order and scan ID.
5. Update the cylinder's custody, state and `last_event_id`.
6. For HANDOVER and TAKE_BACK, insert the `stop_cylinders` row.
7. For the first LOAD on a trip, stamp `load_started_at` (§3.6).

**Stop finish.**
1. Guarded: `UPDATE orders SET status = 'DELIVERED', delivered_at = now(), delivered_by_user_id = $u, delivery_method = 'SCANNED' WHERE id = $o AND delivered_at IS NULL AND status IN ('ASSIGNED','IN_TRANSIT')`.
2. If `confirmation.enabled`, insert the `delivery_confirmations` row and an `outbound_messages` row (`QUEUED`). The office manual delivery v2 does the same in its transaction.
3. **No money.**

**Customer answer:**
1. `UPDATE delivery_confirmations SET response, comment, responded_at = now(), status = 'ANSWERED' WHERE token_hash = $h AND status = 'PENDING' AND expires_at > now()`.
2. Write the audit row (CUSTOMER; no IP or user agent, API_CONTRACT §5.3).
3. In the same transaction, raise one `CUSTOMER_PROBLEM` alert if the answer is in `confirmation.caseOnAnswers` (`alerts.raise(…, tx)`); if raising fails, the answer rolls back.
4. **No money.**

---

## 5. Increment 3 schema (`inc3_refills_dayend`)

### 5.1 Enums
| Enum | Change |
|---|---|
| `CylinderEventType` | add `FILLED` (scanned at the station; custody stays VEHICLE) and `ADJUSTED` (an approved day-end fix) |
| `CylinderEventSource` | add `DAY_END_FIX` (reason required by the existing CHECK) |
| `AlertType` | add `DAY_END_SUBMITTED` |
| new `FillingOrderCylinderStatus` | `PICKED_UP`, `FILLED`, `RETURNED` |
| new `DayCloseStatus` | `OPEN`, `SUBMITTED`, `APPROVED` (locked). Send-back and reopen return it to `OPEN`. |
| new `DayClosePlace` | `STORE`, `VAN`, `CUSTOMER`, `NOT_FOUND` (the sheet's "Missing", and the app's place for a LOST cylinder) |
| new `DayCloseDiff` | `MATCH`, `PLACE_DIFFERS`, `STATE_DIFFERS`, `PLACE_AND_STATE_DIFFER`, `UNKNOWN_CYLINDER` |

### 5.2 Changed models
| Model | Change |
|---|---|
| `FillingOrder` (:917) | `refillNo Int?` (`AG-R007`), `clientRequestId String? @db.Uuid`, `pickedUpAt`, `cancelledAt`, `cancelledByUserId`; relations `cylinders` and `cylinderEvents`. `@@unique([distributorId, refillNo])`, `@@unique([distributorId, clientRequestId])`, `@@index([distributorId, createdAt])`. One size per refill stays (`cylinderTypeId`, :921). `pricePerCylinderPaisa` and `totalCostPaisa` are written as 0. `pickedUpEmptyCount` and `filledCount` are legacy. |
| `CylinderEvent` | `fillingOrderId String?` (FK, RESTRICT) plus `@@index([fillingOrderId])` |
| `Distributor`, `User`, `Vehicle` | `isTest Boolean @default(false) @map("is_test")`, set by `pilot:setup --test` on distributors, their users, the drivers' users and vans; SUPER_ADMIN users are never test rows. The pilot reset deletes only test rows, what hangs off them and their audit rows (API_CONTRACT §10.3). |
| `StoredFile` | relations `dayCloseSheets` and `dayCloseUploads` |

### 5.3 New models
```prisma
model FillingOrderCylinder {
  id             String                     @id @default(uuid()) @db.Uuid
  fillingOrderId String                     @map("filling_order_id") @db.Uuid
  cylinderId     String                     @map("cylinder_id") @db.Uuid
  status         FillingOrderCylinderStatus @default(PICKED_UP)
  stateAtPickup  CylinderState              @map("state_at_pickup")   // EMPTY | PART_FILLED
  pickedUpAt     DateTime                   @default(now()) @map("picked_up_at")
  filledAt       DateTime?                  @map("filled_at")
  returnedAt     DateTime?                  @map("returned_at")       // the store's receive scan
  @@unique([fillingOrderId, cylinderId])
  @@index([cylinderId])
  @@map("filling_order_cylinders")
}
model DayClose {                        // one business day per distributor (Asia/Karachi, 03:00 cut-off); created OPEN by the first sheet download
  id                String         @id @default(uuid()) @db.Uuid
  distributorId     String         @map("distributor_id") @db.Uuid
  businessDate      DateTime       @map("business_date") @db.Date
  status            DayCloseStatus @default(OPEN)
  sheetSnapshotAt   DateTime?      @map("sheet_snapshot_at")    // when the newest sheet was made (the sheet time); only that sheet can be uploaded
  sheetFileId       String?        @map("sheet_file_id") @db.Uuid
  uploadFileId      String?        @map("upload_file_id") @db.Uuid
  uploadVersion     Int            @default(0) @map("upload_version")
  uploadedAt        DateTime?      @map("uploaded_at")
  uploadedByUserId  String?        @map("uploaded_by_user_id") @db.Uuid
  submittedAt       DateTime?      @map("submitted_at")
  approvedAt        DateTime?      @map("approved_at")
  approvedByUserId  String?        @map("approved_by_user_id") @db.Uuid
  sentBackReason    String?        @map("sent_back_reason")
  sentBackAt        DateTime?      @map("sent_back_at")
  reopenReason      String?        @map("reopen_reason")
  reopenedAt        DateTime?      @map("reopened_at")
  lockedAt          DateTime?      @map("locked_at")
  totals            Json?                                       // counts by place, state and size; frozen at approval: an APPROVED day's summary is read from it
  createdAt         DateTime       @default(now()) @map("created_at")
  updatedAt         DateTime       @updatedAt @map("updated_at")
  lines DayCloseLine[]
  @@unique([distributorId, businessDate])
  @@index([status, businessDate])
  @@map("day_closes")
}
model DayCloseLine {                    // one row per cylinder on the uploaded sheet
  id                String         @id @default(uuid()) @db.Uuid
  dayCloseId        String         @map("day_close_id") @db.Uuid
  cylinderId        String?        @map("cylinder_id") @db.Uuid   // NULL = a number the app doesn't know
  sheetKey          String         @map("sheet_key")             // the number in its normal form (AG-C0042, read by parseCylinderNo); a registered extra cylinder gets the next short_no instead
  cylinderTypeId    String?        @map("cylinder_type_id") @db.Uuid
  systemPlace       DayClosePlace? @map("system_place")
  systemHolderId    String?        @map("system_holder_id") @db.Uuid
  systemState       CylinderState? @map("system_state")
  systemLastEventId String?        @map("system_last_event_id") @db.Uuid // the cylinder's last event at upload (the review's Last scan); a fix is skipped when the cylinder's last event is newer than sheet_snapshot_at
  reportedPlace     DayClosePlace? @map("reported_place")
  reportedState     CylinderState? @map("reported_state")
  reasonCode        String?        @map("reason_code")         // reserved: NULL in the pilot (no reason list)
  note              String?                                      // "Why different": 3-200 characters on a differing row; the fix's reason
  diff              DayCloseDiff   @default(MATCH)
  appliedEventId    String?        @unique @map("applied_event_id") @db.Uuid
  skippedMovedAt    DateTime?      @map("skipped_moved_at")
  @@unique([dayCloseId, sheetKey])
  @@index([dayCloseId, diff])
  @@index([cylinderId])
  @@map("day_close_lines")
}
```

### 5.4 inc3 hand edits
- **Pre-check:** block if any refill is not terminal (COMPLETED, CANCELLED, FAILED) and not PENDING. Refills in flight under the old count-based steps can't be finished by scans.
- **Backfills:** `refill_no` per distributor plus `next_refill_no`; `cancelled_at = updated_at` for CANCELLED refills.
- **CHECKs**
  - `filling_orders_count_chk CHECK (requested_count > 0) NOT VALID`. The maximum of 30 is a setting, enforced in code.
  - `foc_pickup_state_chk`: `state_at_pickup::text IN ('EMPTY','PART_FILLED')`.
  - `foc_steps_chk`: the status matches the timestamps.
  - `day_closes_locked_chk`: `(status = 'APPROVED') = (locked_at IS NOT NULL)`.
  - `dcl_unknown_chk`: `(diff = 'UNKNOWN_CYLINDER') = (cylinder_id IS NULL)`.
- **Approval** is one transaction with `{ timeout: 60000 }` (Prisma's default is 5 seconds). Lock the day row `FOR UPDATE` and re-check SUBMITTED and the version. Then, for each line with `diff <> 'MATCH'`, in sheet order:
  1. Lock the cylinder (an `UNKNOWN_CYLINDER` line has none).
  2. If the cylinder's last event is newer than the day's `sheet_snapshot_at` (it moved since the sheet), set `skipped_moved_at` and move on.
  3. Apply the line's fix (API_CONTRACT §10.2). `MOVE_TO_STORE`, `SET_STATE` and `MARK_LOST` each insert one `ADJUSTED` event (source `DAY_END_FIX`, the line's `note` as reason, actor the approver, from and to custody and state) and update the cylinder. `REGISTER` allocates the next `short_no` (`next_cylinder_no`) and inserts a `REGISTERED` event (source `REGISTRATION`) into the home store with the line's size and state. `NOTE_ONLY` changes nothing. Set `applied_event_id` and the cylinder's `last_event_id`.

  Then set the day to APPROVED with `approved_at`, `approved_by_user_id`, `locked_at` and the frozen `totals`, resolve its `DAY_END_SUBMITTED` alert, and write the `day.approve` audit row (diff: applied, skipped, unchanged and registered counts).
- **Business date in SQL:** never write the zone or the cut-off as literals. A query for one business day filters `ts >= $start AND ts < $end`, with the bounds from `businessDayRange(date, { timezone, cutoffLocalTime })` (shared-utils). A query that groups by business date uses `((ts AT TIME ZONE 'UTC') AT TIME ZONE $tz - $cutoff::interval)::date`, with `$tz` = `day.timezone` and `$cutoff` = `day.cutoffLocalTime` (for example '03:00'), both read from SettingsService. With the defaults this is the old `'Asia/Karachi'` and `interval '3 hours'`. Prisma `DateTime` columns are `timestamp(3)` without time zone, holding UTC.
- **Calendar date in SQL** (an expense's "today", fuel-log months): the same zone with no cut-off, `((ts AT TIME ZONE 'UTC') AT TIME ZONE $tz)::date`, with `$tz` = `day.timezone` (Asia/Karachi).

### 5.5 As built (inc3, 2026-10-24)
The migration is `20261024021613_inc3_refills_dayend`. Its generated DDL is `prisma migrate diff` from a snapshot of the Inc 2 schema (`--base-file`, §2.4), then hand-edited as §5.4 says. It was proven on a fresh database (no drift, including the CI shadow-database check), on Inc 2-shaped data through `migrate.sh` (exact numbers, nothing else changed, no money moved, a re-run changes nothing), with the pre-check blocking (nothing applied) and with resolve-then-redeploy.
- **The fix is not stored** (G09-03). `DayCloseFix` (MOVE_TO_STORE, SET_STATE, MARK_LOST, REGISTER, NOTE_ONLY) follows from `(system_place, system_state, reported_place, reported_state)` through `deriveDayCloseFix` in shared-utils. A blank sheet cell means the app's value, Missing means LOST (so a Missing row of a FULL cylinder is PLACE_AND_STATE_DIFFER), and NOTE_ONLY changes nothing.
- **Relations and foreign keys, all RESTRICT:** `filling_order_cylinders` to `filling_orders` and `cylinders`; `cylinder_events.filling_order_id` to `filling_orders`; `day_closes` to `distributors` and twice to `stored_files` (relations `DayCloseSheet` and `DayCloseUpload`); `day_close_lines` to `day_closes`, `cylinders`, `cylinder_types` and `cylinder_events` (the applied event, relation `DayCloseLineAppliedEvent`). Every new table and foreign key is also in the pilot reset's map (`reset-graph.ts`, API_CONTRACT §10.5), which a DB test checks.
- **`cylinder_events.filling_order_id`** is set on a refill pickup (SCAN_OUT, no trip), a fill (FILLED) and the store's receive of a refill cylinder (SCAN_IN), and on an approved day-end MOVE_TO_STORE fix of a cylinder still on an open refill line. The schema comment says so.
- **Pre-check message:** `MIGRATION_BLOCKED inc3: refills in progress (<code> <id> (<status>), … and N more). Finish each refill with the Increment 2 apps first (the driver's steps up to Returned, then the office's Mark complete; a refill not yet picked up may instead be cancelled by its shop), run "prisma migrate resolve --rolled-back 20261024021613_inc3_refills_dayend", then deploy again.` It names at most 20 refills.
- **Backfill:** refill numbers per shop by `(created_at, id)`, continuing after `GREATEST(max refill_no, next_refill_no − 1)` as inc2's `short_no` does, then the counter moves on; `cancelled_at = updated_at` for CANCELLED refills. Re-running it changes nothing.
- **CHECKs:** the five of §5.4, of which only `filling_orders_count_chk` is NOT VALID. `foc_steps_chk`: PICKED_UP has neither time, FILLED has `filled_at`, RETURNED has `returned_at`, filled or not.
- **`day_closes`:** the first sheet download creates the row (`INSERT … ON CONFLICT` on `day_closes_distributor_id_business_date_key`, then `FOR UPDATE`); `totals` is the `DayCloseTotals` of API_CONTRACT §10.5, counted after the approval's fixes.
- **`day_close_lines`:** `system_*` are read inside the upload's transaction; `reported_place` and `reported_state` keep the sheet's raw values (null for a blank cell); an Extra cylinders line has `cylinder_id` NULL, `reported_place` STORE and `sheet_key` the sheet's number, and `applied_event_id` points at the new cylinder's REGISTERED event; `skipped_moved_at` is the time of the move that caused the skip.

---

## 6. Raw SQL and PostGIS caveats
1. **Rows with a required `Unsupported("geometry")` column are created with raw INSERTs.** These sites must keep working:
   - orders.service.ts:37 (orders) and :273, :280 (trip_stops);
   - dispatch.service.ts:96, :103;
   - stores.service.ts:21;
   - zones.service.ts:32;
   - clients.service.ts:63;
   - filling-stations.service.ts:53.

   Every new column on these tables is nullable or has a database default. New values are set in the same raw INSERT, or in the same transaction.
2. **`@default(uuid())` is client-side.** Raw SQL and backfills use `gen_random_uuid()`. Enum parameters need `::"EnumName"` casts.
3. **Geometry reads stay raw** (`ST_X`/`ST_Y`), as in trips.service.ts:82-106.
4. **GIST indexes are declared in the schema** (`@@index([…], type: Gist)`), never in raw SQL.
5. **Extensions:** the baseline creates `postgis`, `uuid-ossp` and `pgcrypto`. Prisma never drops them. **Never run `prisma db pull`.**
6. **Zone lookup is one rule everywhere**, in code and backfills: active zones only, `ST_Covers` (border points count), `ORDER BY ST_Area(polygon), created_at, id LIMIT 1`. It replaces `ST_Contains … LIMIT 1` at zones.service.ts:47-55.
7. **Never change a geometry type or SRID through a Prisma diff.** It rewrites the table.
8. **Plain `CREATE INDEX` is fine** at the pilot's size. `CONCURRENTLY` can't run inside a migration's transaction.

## 7. Constraint to API result (one central Prisma error filter)
| Constraint or condition | API result |
|---|---|
| `payments_bank_reference_key_key` | 409 `TOPUP_BANK_REFERENCE_USED` |
| `orders_distributor_id_client_request_id_key`, `payments_…`, `filling_orders_…` (Inc 3), `clients_distributor_id_client_request_id_key`, `expenses_client_request_id_key`, `distributors_client_request_id_key` | return the first record, 200 plus `Idempotent-Replay: true` |
| `ledger_entries_idempotency_key_key`, `outbound_messages_idempotency_key_key`, `cylinder_events_actor_user_id_client_scan_id_key` | the step was already done: return the first result (a correction answers 200 with `Idempotent-Replay: true`, API_CONTRACT §7.8) |
| the guarded balance update changed 0 rows; CHECK `distributors_balance_chk` (23514) as a safety net | 409 `WALLET_INSUFFICIENT_BALANCE` |
| `stop_cylinders_trip_stop_id_cylinder_id_key` | 409 `SCAN_GIVEN_THIS_VISIT` (the service checks first; this is the safety net) |
| `distributor_zone_prices_distributor_id_zone_id_key` (two first saves at once) | retry once, then 409 `CONFLICT_STALE_STATE` |
| `distributors_home_store_id_key` | 409 `STORE_IN_USE` |
| `distributors_code_key` / `distributors_code_chk` | 409 `DISTRIBUTOR_CODE_IN_USE` / 400 `DISTRIBUTOR_CODE_INVALID` |
| `expense_types_name_key_key` | 409 `EXPENSE_TYPE_NAME_TAKEN` |
| `clients_distributor_id_phone_key` (from 1b; the service checks first, under the distributor-row lock, §3.6) | 409 `CLIENT_PHONE_EXISTS` with the existing customer's `{clientId, name}` |
| `users_phone_key` | 409 `USER_PHONE_IN_USE` |
| `day_closes_distributor_id_business_date_key` | return the existing day |

"Return the first record" (or the existing day) is done by the owning service, which catches the violation and re-reads the row. A violation of one of these keys that reaches the central filter answers 409 `CONFLICT_DUPLICATE`, as the built `KNOWN_UNIQUE_CONSTRAINTS` does.

## 8. shared-types mirror (packages/shared-types/src)
Every enum change above is mirrored in the same pull request:
- **order.types.ts:** `OrderFeeStatus`, `FeeStrategy`, `DeliveryMethod`, `OrderStage`, `OrderCancelReason`, `DeliveryFailureReason`; Order DTO fields. `OrderPaymentStatus` is marked deprecated.
- **payment.types.ts:** `PaymentStatus.REJECTED`, `PayerChannel`, `TopupRejectReason`; `providerTxnId` optional.
- **ledger.types.ts:** `CREDIT_ORDER_REVERSAL`, `DEBIT_REFILL`, `StatementKind`, `CorrectionReason`.
- **trip.types.ts:** `TripStopStatus`.
- **cylinder.types.ts** (Inc 2): `PART_FILLED`, `REGISTERED`, `CylinderEventSource`, `shortNo`. Inc 3 adds `FILLED` and `ADJUSTED`.
- **New files:**
  - `errors.ts`
  - `settings.ts`
  - `wallet.types.ts`
  - `expense.types.ts`
  - `file.types.ts`
  - `audit.types.ts`
  - `confirmation.types.ts` (Inc 2)
  - `day-end.types.ts` (Inc 3)

## 9. After the pilot (not in these migrations)
- **Contract migration**
  - Drop `orders.payment_status`, `expenses.category` and `ExpenseCategory`, `expenses.vendor/notes/receipt_url`, `inventory_lots`, `reconciliations`, `filling_stations.price_per_cylinder_paisa`, `pricing_rules` (with its legacy routes) and the `FillingOrder` legacy count and DIY columns.
  - Add `NOT VALID` foreign keys on `cylinder_events.trip_id` and `order_id` once orphans are checked.
- **Future features fit additively**
  - `FeeStrategy.ZONES_CROSSED` plus its own price table.
  - A refill delivery cost: `DEBIT_REFILL` plus a new `CREDIT_REFILL_REVERSAL` value.
  - A `payment_provider_events` log for Easypaisa.
  - `inbound_messages` for WhatsApp replies.
  - Per-distributor setting scopes.
  - A two-sided handover.
  - The second approver: add `AWAITING_SECOND_APPROVAL` and `first_approved_*` in the migration that switches it on.
