-- flat_delivery_cost (docs/pilot/DATA_MODEL.md §5.7; DECISIONS ADR-08, 2026-10-26). Generated with the repo's
-- new-migration flow (prisma migrate diff --script from the users_app_seen schema,
-- test/helpers/fixtures/schema.appseen.prisma = prisma/schema.prisma at 3fc6762, to prisma/schema.prisma), then
-- hand-edited in the DATA_MODEL §2.4 order. The owner's decision: "We are managing deliveries not cylinder
-- pricing. Only delivery costs." The delivery cost is ONE flat amount per order, per distributor per zone
-- (distributor_zone_prices.base_paisa, kept), so the per-size amounts go: the price's size rows and their table,
-- and each order line's copy of its size amount.
-- The file runs as ONE transaction: if any statement fails, nothing is applied.
--
-- No money: nothing here touches distributors.advance_balance_paisa or ledger_entries. Placed orders keep their
-- cost: orders.delivery_fee_paisa (what was deducted, and what a cancel before delivery has started refunds),
-- fee_status and fee_base_paisa are left as they are.

-- (1) PRE-CHECK [hand edit]: none, on purpose. Dropping the per-size rows loses nothing that is still used:
--     - No release that reads them was ever deployed. Live runs af889bf, whose schema never had them (release 1,
--       the baseline, changes no table). This migration ships in release 2 with inc1a, which creates them in the
--       same deploy, so on live the table is still empty when it is dropped.
--     - A database that ran inc1a earlier (dev, test, a staging rehearsal) holds test data only (owner,
--       2026-10-26: "Live has only test data and nothing is deployed").
--     - The amounts were display copies: from this release no quote, order, refund or wallet check reads them
--       (one cost per order).
--     So this contract step needs no release in between (DATA_MODEL §1 rule 6): live's previous release never
--     knew these columns, and a database whose code did holds only test data.

-- (2) GENERATED DDL (unchanged)
-- DropForeignKey
ALTER TABLE "distributor_zone_price_sizes" DROP CONSTRAINT "distributor_zone_price_sizes_price_id_fkey";

-- DropForeignKey
ALTER TABLE "distributor_zone_price_sizes" DROP CONSTRAINT "distributor_zone_price_sizes_cylinder_type_id_fkey";

-- AlterTable
ALTER TABLE "order_lines" DROP COLUMN "fee_paisa",
DROP COLUMN "fee_per_cylinder_paisa";

-- DropTable
DROP TABLE "distributor_zone_price_sizes";

-- (3) BACKFILLS [hand edit]: none. A placed order's cost lives in orders.delivery_fee_paisa, which is unchanged.

-- (4) CHECK CONSTRAINTS [hand edit]: none. dzps_amount_chk went with its table; distributor_zone_prices keeps
--     dzp_base_chk (base_paisa >= 0) and orders keeps orders_fee_chk.
