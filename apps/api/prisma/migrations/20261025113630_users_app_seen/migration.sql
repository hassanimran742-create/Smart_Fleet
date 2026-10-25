-- users_app_seen (docs/pilot/DATA_MODEL.md §5.6). Generated with the repo's new-migration flow (prisma migrate
-- diff --script from the Increment 3 schema, test/helpers/fixtures/schema.inc3.prisma = prisma/schema.prisma at
-- the review23 commit, to prisma/schema.prisma), then hand-edited in the DATA_MODEL §2.4 order. It has no
-- pre-check and no backfill: the three columns are new and nullable, and stay NULL until a shop or driver call
-- is seen (AppSeenService, API_CONTRACT §8.5 step 10), so the previous release keeps starting and writing.
-- The file runs as ONE transaction: if any statement fails, nothing is applied.
--
-- No money: nothing here touches distributors.advance_balance_paisa or ledger_entries.

-- (1) PRE-CHECK [hand edit]: none. No existing row can block three new nullable columns.

-- (2) GENERATED DDL (unchanged)
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "app_seen_at" TIMESTAMP(3),
ADD COLUMN     "app_variant" TEXT,
ADD COLUMN     "app_version" TEXT;

-- (3) BACKFILLS [hand edit]: none. A user's app is known only from their next signed-in call.

-- (4) CHECK CONSTRAINTS [hand edit]. Prisma never diffs CHECKs, so later migrations keep them. Every existing
--     row has the three columns NULL, so both are validated at once (no NOT VALID).
-- A phone app only, and the three columns are set together.
ALTER TABLE users ADD CONSTRAINT users_app_seen_chk CHECK (
     (app_variant IS NULL AND app_version IS NULL AND app_seen_at IS NULL)
  OR (app_variant IN ('driver', 'distributor') AND app_version IS NOT NULL AND app_seen_at IS NOT NULL));
-- The version the update gate read: x.y.z, with an optional pre-release or build suffix (the API's parseAppVersion).
ALTER TABLE users ADD CONSTRAINT users_app_version_chk CHECK (
  app_version IS NULL OR app_version ~ '^[0-9]{1,6}[.][0-9]{1,6}[.][0-9]{1,6}([-+][0-9A-Za-z.-]{1,64})?$');
